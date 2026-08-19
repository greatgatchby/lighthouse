import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { enqueue } from "@/lib/boss";
import { claude, logUsage, MODEL } from "@/lib/claude/client";
import { backfillCategoriesFromMerchants } from "@/lib/finance/ingest";
import { env } from "@/lib/env";
import { normaliseMerchant } from "@/lib/format";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// Nightly merchant categorisation, via the Message Batches API — half price,
// and nobody is waiting on it. Only merchants ingest couldn't place for free
// (no merchant memory, no rule, no provider category) reach here, so this
// shrinks towards nothing as the app learns.
//
// The system prompt carries no dates, counts or ids on purpose: it's the
// cached prefix, and a prefix that changes nightly caches nothing.
//
// A batch can take up to an hour, but pg-boss expires an active job after 15
// minutes. So the job polls for ~11 minutes, then re-queues itself carrying
// the batch id and picks up where it left off.

const CHUNK_SIZE = 25;
const MAX_MERCHANTS = 500;
const POLL_INTERVAL_MS = 60_000;
const POLL_BUDGET_MS = 11 * 60 * 1000;
const TOTAL_BUDGET_MS = 50 * 60 * 1000;
const RESUME_DELAY_SECONDS = 120;

const AssignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      merchant: z.string().describe("the merchant name exactly as it was given"),
      categorySlug: z.string().describe("one slug from the category list"),
    }),
  ),
});

interface CategoriseData {
  batchId?: string;
  startedAt?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Merchants we've actually sent money to that nothing else could place. */
async function pendingMerchants() {
  return db
    .selectDistinct({
      id: tables.merchants.id,
      displayName: tables.merchants.displayName,
    })
    .from(tables.merchants)
    .innerJoin(tables.transactions, eq(tables.transactions.merchantId, tables.merchants.id))
    .where(isNull(tables.merchants.categoryId))
    .limit(MAX_MERCHANTS);
}

async function createBatch(): Promise<string | null> {
  const pending = await pendingMerchants();
  if (pending.length === 0) {
    console.log("[categorise] nothing unknown tonight");
    return null;
  }

  const categories = await db
    .select()
    .from(tables.categories)
    .orderBy(asc(tables.categories.sortOrder), asc(tables.categories.slug));
  if (categories.length === 0) return null;

  const systemPrompt = [
    "You label merchants for one person's private finance app.",
    "Given merchant names as they appear on a bank statement, assign each one exactly one category slug from this list:",
    "",
    ...categories.map((c) => `- ${c.slug}: ${c.name}`),
    "",
    "Rules:",
    "- Return one assignment per merchant given, echoing the merchant name exactly as written.",
    "- Statement names are noisy (card terminals, city suffixes, reference numbers). Judge the underlying business.",
    "- If a merchant genuinely fits nothing, use `other` — never invent a slug.",
    "- Supermarkets are groceries even when they sell everything; coffee shops are coffee rather than eating-out.",
  ].join("\n");

  const chunks: (typeof pending)[] = [];
  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    chunks.push(pending.slice(i, i + CHUNK_SIZE));
  }

  const batch = await claude().messages.batches.create({
    requests: chunks.map((chunk, index) => ({
      custom_id: `chunk-${index}`,
      params: {
        model: MODEL,
        max_tokens: 4096,
        // NOTE: the Batches API rejects `fallbacks` — do not add it here.
        system: [
          {
            type: "text" as const,
            text: systemPrompt,
            cache_control: { type: "ephemeral" as const },
          },
        ],
        messages: [
          {
            role: "user" as const,
            content: `Categorise these merchants:\n${chunk
              .map((m) => `- ${m.displayName}`)
              .join("\n")}`,
          },
        ],
        output_config: { format: zodOutputFormat(AssignmentsSchema) },
      },
    })),
  });

  await db.insert(tables.auditLog).values({
    kind: "categorise:batch",
    detail: { batchId: batch.id, merchants: pending.length, chunks: chunks.length },
  });

  return batch.id;
}

async function applyResults(batchId: string): Promise<void> {
  // Rebuild the name map from the database rather than from the request, so a
  // resumed run needs nothing but the batch id.
  const pending = await pendingMerchants();
  const byName = new Map(pending.map((m) => [normaliseMerchant(m.displayName), m]));

  const categories = await db.select().from(tables.categories);
  const bySlug = new Map(categories.map((c) => [c.slug, c]));

  let assigned = 0;
  let unknownSlugs = 0;
  const touchedMerchantIds: string[] = [];

  for await (const entry of await claude().messages.batches.results(batchId)) {
    if (entry.result.type !== "succeeded") {
      console.error(`[categorise] ${entry.custom_id}: ${entry.result.type}`);
      continue;
    }

    const message = entry.result.message;
    await logUsage("categorise", message.usage);

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || !("text" in textBlock)) continue;

    let payload: unknown;
    try {
      payload = JSON.parse(textBlock.text);
    } catch {
      console.error(`[categorise] ${entry.custom_id}: unparseable output`);
      continue;
    }
    const parsed = AssignmentsSchema.safeParse(payload);
    if (!parsed.success) continue;

    for (const assignment of parsed.data.assignments) {
      const merchant = byName.get(normaliseMerchant(assignment.merchant));
      if (!merchant) continue;
      const category = bySlug.get(assignment.categorySlug.trim().toLowerCase());
      if (!category) {
        unknownSlugs += 1;
        continue;
      }
      await db
        .update(tables.merchants)
        .set({ categoryId: category.id, categorySource: "claude" })
        .where(eq(tables.merchants.id, merchant.id));
      touchedMerchantIds.push(merchant.id);
      assigned += 1;
    }
  }

  const backfilled =
    touchedMerchantIds.length > 0 ? await backfillCategoriesFromMerchants(touchedMerchantIds) : 0;

  await db.insert(tables.auditLog).values({
    kind: "categorise:applied",
    detail: { batchId, assigned, unknownSlugs, backfilled },
  });
}

const categorise: JobDefinition = {
  queue: QUEUES.categorise,
  schedule: { cron: "0 3 * * *" },
  handler: async (jobs) => {
    if (!env.anthropicApiKey) {
      console.log("[categorise] no ANTHROPIC_API_KEY — skipping");
      return;
    }

    const resume = jobs
      .map((job) => (job.data ?? {}) as CategoriseData)
      .find((data) => typeof data.batchId === "string");

    const startedAt = resume?.startedAt ?? Date.now();
    const batchId = resume?.batchId ?? (await createBatch());
    if (!batchId) return;

    const pollUntil = Date.now() + POLL_BUDGET_MS;
    let status = (await claude().messages.batches.retrieve(batchId)).processing_status;

    while (status !== "ended" && Date.now() < pollUntil) {
      await sleep(POLL_INTERVAL_MS);
      status = (await claude().messages.batches.retrieve(batchId)).processing_status;
    }

    if (status !== "ended") {
      if (Date.now() - startedAt < TOTAL_BUDGET_MS) {
        // hand ourselves the batch id and come back — pg-boss expires an
        // active job after 15 minutes, so we never sit on one for longer
        await enqueue(
          QUEUES.categorise,
          { batchId, startedAt },
          { startAfter: RESUME_DELAY_SECONDS, singletonKey: `resume-${batchId}` },
        );
        return;
      }
      await db.insert(tables.auditLog).values({
        kind: "categorise:timeout",
        detail: { batchId, status },
      });
      return;
    }

    await applyResults(batchId);
  },
};

export default categorise;
