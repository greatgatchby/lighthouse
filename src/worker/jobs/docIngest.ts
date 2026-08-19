import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { and, asc, desc, eq, gte, isNull, lte, sql as dsql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, tables } from "@/db";
import { claude, logUsage, MODEL } from "@/lib/claude/client";
import { normaliseMerchant } from "@/lib/format";
import { sendPush } from "@/lib/push";
import { QUEUES } from "@/lib/queues";
import { readStoredFile } from "@/lib/storage";
import type { JobDefinition } from "../types";

// Extract + file one captured document.
//
// The filing half is the interesting half: block 1 of the system prompt is the
// frozen persona (cached for an hour — no dates, no ids, nothing volatile),
// block 2 carries the live taxonomy plus the corrections they've made by hand.
// Every "wrong folder?" tap becomes a few-shot example here, so the filing
// drifts towards their taste instead of ours.

const RETRY_LIMIT = 2;

const ExtractionSchema = z.object({
  docType: z
    .string()
    .describe("short lowercase kind: bill, receipt, statement, policy, letter, payslip, id, warranty"),
  issuer: z.string().describe("who sent it — the company, department or person"),
  title: z.string().describe("short human title, e.g. 'British Gas — March statement'"),
  issuedAt: z.string().nullable().describe("YYYY-MM-DD printed on the document, else null"),
  expiresAt: z
    .string()
    .nullable()
    .describe("YYYY-MM-DD it expires/renews/is due, only if the document genuinely has one"),
  amountPence: z
    .number()
    .int()
    .nullable()
    .describe("the single headline amount in integer pence, positive (£41.20 → 4120), else null"),
  reference: z.string().nullable().describe("account/policy/invoice reference, else null"),
  summary: z.string().describe("one or two calm sentences: what this is and why it might matter"),
  tags: z.array(z.string()).max(6).describe("2-5 short lowercase keywords"),
  extractedText: z
    .string()
    .describe("the document's text, verbatim and plain, for full-text search — no commentary"),
  folder: z.object({
    existing: z.string().nullable().describe("a folder name copied verbatim from the taxonomy"),
    proposedNew: z.string().nullable().describe("a new short generic folder name, only if nothing fits"),
  }),
});

// STABLE PREFIX — cached. Never put a date, an id or anything per-document here.
const FILING_SYSTEM = `You are the filing assistant inside one person's private life app. They photograph or share a piece of paper; you read it and put it where they'd have put it.

Reading rules:
- Only report what is actually on the page. Anything you can't see is null — never guess a date, an amount or a reference.
- extractedText is the verbatim text of the document, plain, top to bottom. It is the search index, so completeness matters more than tidiness. No commentary, no summary, no markdown.
- amountPence is the one headline amount as positive integer pence (£41.20 → 4120). Null when the document isn't about a single amount.
- expiresAt is only for documents that genuinely run out or renew: passport, licence, MOT, insurance, warranty, permit, tenancy, subscription term. A bill's due date counts. Otherwise null.
- title is short and human, the way they'd say it out loud.
- summary is one or two calm sentences. Never alarming, never nagging.

Filing rules:
- Reuse an existing folder whenever one plausibly fits. Reusing a slightly-imperfect folder is better than growing the taxonomy.
- Only propose a new folder when nothing in the list fits at all.
- Folder names are short, generic and reusable: "Utilities", "Insurance", "Car", "Health", "Payslips", "Tax", "Home". Never a company name plus a month ("British Gas March"), never a date, never a reference number, never a sentence.
- Exactly one of folder.existing and folder.proposedNew is non-null. folder.existing must be copied character-for-character from the taxonomy you are given.
- The corrections list shows filings this person moved by hand. Their taste wins over yours — if a similar document ended up somewhere, put this one there too.

Good folder names: Utilities. Insurance. Car. Home. Health. Payslips. Tax. Banking. Council. Travel. Warranties. Pets. Work.
Bad folder names, and why: "British Gas March" (a company and a month — next month it's useless), "Electricity bill 2024" (a year), "Ref 88213004" (a reference), "Documents about the flat renewal" (a sentence), "Misc" (says nothing), "Energy provider correspondence" (long where "Utilities" already exists).

What to pull out, by kind:
- bill / invoice: issuer is the company billing them. amountPence is the total due, not a line item, not the previous balance, not the direct-debit estimate. reference is the account or invoice number. expiresAt is the payment due date. issuedAt is the bill or statement date.
- receipt: issuer is the shop or restaurant. amountPence is the total paid including VAT and tip. issuedAt is the transaction date on the receipt — that date and total are what link it to the payment in their bank feed, so copy them exactly. No expiresAt unless the receipt carries a returns deadline.
- bank or card statement: issuer is the bank. amountPence is the closing balance only if the statement is genuinely about one figure; otherwise null. reference is the masked account number. No expiresAt.
- payslip: issuer is the employer. amountPence is net pay. issuedAt is the pay date. reference is the payroll or employee number. No expiresAt.
- insurance policy / renewal: issuer is the insurer. amountPence is the premium. reference is the policy number. expiresAt is the renewal or cover-end date — this one matters, get it right.
- identity document (passport, driving licence, visa, permit): issuer is the issuing authority. expiresAt is the expiry printed on it. reference is the document number. amountPence is null.
- vehicle (MOT, road tax, service, V5C): issuer is the garage or agency. expiresAt is the MOT or tax expiry. reference is the registration.
- tenancy / mortgage: issuer is the landlord, agency or lender. expiresAt is the end of the fixed term. amountPence is the rent or monthly payment.
- medical (appointment, prescription, results): issuer is the practice or hospital. expiresAt is the appointment date if there is one. Keep the summary factual and unalarming — describe, never interpret or advise.
- letter with no money in it: amountPence null, reference only if the letter quotes one, expiresAt only if it names a deadline they must act on.

Dates:
- Every date is YYYY-MM-DD, taken from the page. British documents write days first: 03/04 is 3 April, not 4 March.
- If a date is partial ("March 2026"), use the first of the month only when the document clearly means the whole month; otherwise null.
- Never derive a date from anything other than the document itself.

Summary tone: one or two sentences, plain and calm, saying what the thing is and the one reason it might matter later. No urgency words, no exclamation marks, no advice, no "you should". If the document is dull, the summary is allowed to be dull.

Tags: two to five lowercase words someone would actually search for — a company, a kind, a place, a vehicle, a person. Not "document", not "pdf", not "important".`;

const IMAGE_MEDIA = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMedia = (typeof IMAGE_MEDIA)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 10);
  if (!DATE_ONLY.test(trimmed)) return null;
  return Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`)) ? null : trimmed;
}

function tidyFolderName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 60);
}

function clip(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** The live taxonomy + up to 10 worked examples of their filing taste. Uncached
 *  on purpose: it changes every time they correct something. */
async function buildFilingContext(): Promise<{ block: string; folders: { id: string; name: string }[] }> {
  const folders = await db
    .select({ id: tables.folders.id, name: tables.folders.name })
    .from(tables.folders)
    .orderBy(asc(tables.folders.name));

  const fromFolder = alias(tables.folders, "from_folder");
  const toFolder = alias(tables.folders, "to_folder");

  const corrections = await db
    .select({
      docType: tables.documents.docType,
      issuer: tables.documents.issuer,
      title: tables.documents.title,
      from: fromFolder.name,
      to: toFolder.name,
    })
    .from(tables.filingCorrections)
    .innerJoin(tables.documents, eq(tables.filingCorrections.documentId, tables.documents.id))
    .leftJoin(fromFolder, eq(tables.filingCorrections.fromFolderId, fromFolder.id))
    .innerJoin(toFolder, eq(tables.filingCorrections.toFolderId, toFolder.id))
    .orderBy(desc(tables.filingCorrections.createdAt))
    .limit(10);

  const taxonomy =
    folders.length > 0
      ? folders.map((folder) => `- ${folder.name}`).join("\n")
      : "(no folders yet — this is the first thing they've filed)";

  const examples =
    corrections.length > 0
      ? corrections
          .map(
            (row) =>
              `- a ${row.docType ?? "document"} from ${row.issuer ?? "an unknown sender"} titled ${
                row.title ?? "(untitled)"
              } was refiled from ${row.from ?? "unfiled"} to ${row.to}`,
          )
          .join("\n")
      : "(none yet — nothing has been refiled by hand)";

  return {
    folders,
    block: `Current folders (reuse one of these whenever it fits):\n${taxonomy}\n\nHow this person actually files — corrections they made by hand, most recent first:\n${examples}`,
  };
}

/** A receipt is worth linking to the money it came out of: same amount (±1p),
 *  within three days, merchant preferred. Never steals a transaction another
 *  document already claims. */
async function findMatchingTransaction(
  amountPence: number,
  issuedAt: string,
  issuer: string | null,
): Promise<string | null> {
  const target = -Math.abs(amountPence);
  const day = Date.parse(`${issuedAt}T00:00:00Z`);
  if (Number.isNaN(day)) return null;
  const from = new Date(day - 3 * 86_400_000);
  const to = new Date(day + 4 * 86_400_000 - 1);

  const candidates = await db
    .select({
      id: tables.transactions.id,
      postedAt: tables.transactions.postedAt,
      amount: tables.transactions.amount,
      description: tables.transactions.description,
      merchant: tables.merchants.displayName,
    })
    .from(tables.transactions)
    .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
    .where(
      and(
        isNull(tables.transactions.supersededBy),
        eq(tables.transactions.declined, false),
        gte(tables.transactions.amount, target - 1),
        lte(tables.transactions.amount, target + 1),
        gte(tables.transactions.postedAt, from),
        lte(tables.transactions.postedAt, to),
        dsql`not exists (select 1 from documents d where d.transaction_id = ${tables.transactions.id})`,
      ),
    )
    .limit(25);

  if (candidates.length === 0) return null;

  const wanted = normaliseMerchant(issuer ?? "");
  const wantedTokens = new Set(wanted.split(" ").filter((token) => token.length >= 4));

  const scored = candidates.map((row) => {
    const name = normaliseMerchant(row.merchant ?? row.description ?? "");
    const tokens = name.split(" ").filter((token) => token.length >= 4);
    const merchantMatch =
      wanted.length >= 3 &&
      name.length > 0 &&
      (name.includes(wanted) || wanted.includes(name) || tokens.some((t) => wantedTokens.has(t)));
    return {
      id: row.id,
      merchantMatch,
      dayGap: Math.abs(row.postedAt.getTime() - day),
      amountGap: Math.abs(row.amount - target),
    };
  });

  scored.sort(
    (a, b) =>
      Number(b.merchantMatch) - Number(a.merchantMatch) ||
      a.dayGap - b.dayGap ||
      a.amountGap - b.amountGap,
  );

  return scored[0].id;
}

async function ingestDocument(documentId: string): Promise<void> {
  const [doc] = await db
    .select()
    .from(tables.documents)
    .where(eq(tables.documents.id, documentId))
    .limit(1);
  if (!doc) return;
  if (doc.status === "extracted") return; // already read (a duplicate re-share, or a retry after success)

  const bytes = await readStoredFile(doc.sha256, doc.mimeType, doc.filename);
  const data = bytes.toString("base64");

  let fileBlock: ContentBlockParam;
  if (doc.mimeType === "application/pdf") {
    fileBlock = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    };
  } else if ((IMAGE_MEDIA as readonly string[]).includes(doc.mimeType)) {
    fileBlock = {
      type: "image",
      source: { type: "base64", media_type: doc.mimeType as ImageMedia, data },
    };
  } else {
    throw new Error(`can't read ${doc.mimeType} yet — share it again as a JPEG, PNG or PDF`);
  }

  const { block: filingContext, folders } = await buildFilingContext();

  const response = await claude().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: [
      { type: "text", text: FILING_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: filingContext },
    ],
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: `Read this document and file it. Captured as: ${doc.filename}`,
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });
  await logUsage("doc-ingest", response.usage);

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("doc-ingest: model returned unparseable output");

  // Resolve the folder: an existing name files it now, anything else waits for a tap.
  const byName = new Map(folders.map((folder) => [folder.name.toLowerCase(), folder]));
  let folderId: string | null = null;
  let folderName: string | null = null;
  let proposedFolderName: string | null = null;

  const suggested = tidyFolderName(parsed.folder.existing ?? "");
  const proposed = tidyFolderName(parsed.folder.proposedNew ?? "");
  const wanted = suggested || proposed;
  if (wanted) {
    const match = byName.get(wanted.toLowerCase());
    if (match) {
      folderId = match.id;
      folderName = match.name;
    } else {
      proposedFolderName = wanted;
    }
  }

  const issuedAt = isoDate(parsed.issuedAt);
  const amountPence =
    typeof parsed.amountPence === "number" && Number.isFinite(parsed.amountPence)
      ? Math.round(Math.abs(parsed.amountPence))
      : null;
  const issuer = clip(parsed.issuer, 200);
  const title = clip(parsed.title, 200) ?? doc.filename;

  const transactionId =
    amountPence && issuedAt ? await findMatchingTransaction(amountPence, issuedAt, issuer) : null;

  await db
    .update(tables.documents)
    .set({
      status: "extracted",
      docType: clip(parsed.docType, 60),
      issuer,
      title,
      issuedAt,
      expiresAt: isoDate(parsed.expiresAt),
      amount: amountPence,
      reference: clip(parsed.reference, 120),
      summary: clip(parsed.summary, 2000),
      tags: parsed.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 6),
      extractedText: parsed.extractedText,
      folderId,
      proposedFolderName,
      filedAt: folderId ? new Date() : null,
      transactionId,
      error: null,
    })
    .where(eq(tables.documents.id, documentId));

  // Only tell them about it when it's actually away — a proposal waits quietly
  // on the page instead of asking for attention.
  if (folderId && folderName) {
    await sendPush({
      title: "Documents",
      body: `Filed: ${title} → ${folderName}`,
      url: "/documents",
      tag: `doc-${documentId}`,
      category: "documents",
    });
  }
}

const docIngest: JobDefinition<{ documentId?: string }> = {
  queue: QUEUES.docIngest,
  // retryCount tells us whether this was the last go, so a mid-flight failure
  // doesn't get marked "failed" while pg-boss still intends to retry it
  workOptions: { includeMetadata: true },
  handler: async (jobs) => {
    for (const job of jobs) {
      const documentId = job.data?.documentId;
      if (!documentId) continue;
      try {
        await ingestDocument(documentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retryCount = (job as { retryCount?: number }).retryCount ?? RETRY_LIMIT;
        const finalAttempt = retryCount >= RETRY_LIMIT;
        await db
          .update(tables.documents)
          .set({ error: message.slice(0, 500), ...(finalAttempt ? { status: "failed" as const } : {}) })
          .where(eq(tables.documents.id, documentId));
        throw err; // let pg-boss retry per the queue policy
      }
    }
  },
};

export default docIngest;
