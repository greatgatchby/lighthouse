import { and, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, tables } from "@/db";
import type { Provider } from "@/db/schema/finance";
import { dedupeKeyForDate } from "@/lib/dedupe";
import { localDay, normaliseMerchant } from "@/lib/format";
import type { MonzoMerchantRaw, MonzoTransactionRaw } from "@/lib/providers/monzo";

// One ingest path for every provider (Monzo, Lunchflow, CSV).
//
// Rules of the road:
//   • money is integer pence, negative = money out
//   • a row is identified by (accountId, providerTxId) — re-ingesting the same
//     transaction updates amount/settled/declined and never duplicates
//   • categories are decided for free where possible; anything left null is
//     picked up by the nightly `categorise` batch job
//   • £0 rows are active-card checks, not spending — skipped entirely

// ------------------------------------------------------------------ types

export interface IngestInput {
  providerTxId: string;
  postedAt: Date;
  settledAt?: Date | null;
  /** signed pence; negative = money out */
  amount: number;
  currency?: string | null;
  description?: string | null;
  merchantName?: string | null;
  /** provider's own merchant id (Monzo) */
  providerMerchantId?: string | null;
  merchantLogo?: string | null;
  /** provider's own category string, mapped to our slugs where we recognise it */
  providerCategory?: string | null;
  declined?: boolean;
  notes?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface IngestedRow {
  id: string;
  providerTxId: string;
  /** true when this row did not exist before this ingest */
  isNew: boolean;
  amount: number;
  postedAt: Date;
  description: string;
  merchantId: string | null;
  merchantName: string | null;
  categorySlug: string | null;
  categoryKind: string | null;
  impulseProne: boolean;
  declined: boolean;
}

export interface IngestSummary {
  rows: IngestedRow[];
  inserted: number;
  updated: number;
  skipped: number;
  /** earliest postedAt seen in this batch, or null */
  earliest: Date | null;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  isImpulseProne: boolean;
}

interface RuleRow {
  id: string;
  pattern: string;
  field: "description" | "merchant";
  categoryId: string;
}

interface MerchantRef {
  id: string;
  categoryId: string | null;
}

export interface IngestContext {
  timezone: string;
  categoriesById: Map<string, CategoryRow>;
  categoriesBySlug: Map<string, CategoryRow>;
  rules: RuleRow[];
  merchantCache: Map<string, MerchantRef>;
  ruleHits: Map<string, number>;
}

// --------------------------------------------------- provider category maps

/** Monzo's own category strings → our slugs. Unknown values fall through to null. */
export const MONZO_CATEGORY_MAP: Record<string, string> = {
  general: "other",
  expenses: "other",
  eating_out: "eating-out",
  groceries: "groceries",
  shopping: "shopping",
  transport: "transport",
  bills: "bills",
  entertainment: "entertainment",
  holidays: "travel",
  cash: "cash",
  personal_care: "personal-care",
  family: "gifts",
  gifts: "gifts",
  charity: "gifts",
  finances: "fees",
  savings: "savings",
  transfers: "transfers",
  income: "other-income",
  salary: "salary",
  pets: "pets",
  home: "home",
  rent: "rent-mortgage",
  mortgage: "rent-mortgage",
  education: "education",
  fitness: "health",
  health: "health",
  medical: "health",
  tech: "tech",
  gadgets: "tech",
  hobbies: "hobbies",
  subscriptions: "subscriptions",
  coffee: "coffee",
  travel: "travel",
};

export function mapProviderCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return MONZO_CATEGORY_MAP[key] ?? null;
}

/** "Eating out" → "eating-out": a CSV's own category column often already matches a slug. */
export function slugifyCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || null;
}

// -------------------------------------------------------------- date helpers

/** Offset (ms) between UTC and the given zone at that instant. */
function zoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/** The instant local midnight on the 1st of the current calendar month. */
export function localMonthStart(timezone: string, at = new Date()): Date {
  const [year, month] = localDay(at, timezone).split("-").map(Number);
  let guess = Date.UTC(year, month - 1, 1, 0, 0, 0);
  // two passes converge across DST boundaries
  for (let i = 0; i < 2; i += 1) {
    guess = Date.UTC(year, month - 1, 1, 0, 0, 0) - zoneOffsetMs(new Date(guess), timezone);
  }
  return new Date(guess);
}

/** Day of the month (1-31) in the app timezone. */
export function localDayOfMonth(at: Date, timezone: string): number {
  return Number(localDay(at, timezone).split("-")[2]);
}

// ------------------------------------------------------------ salary shapes

const SALARY_WORDS =
  /\b(salary|salaries|payroll|wages?|pay\s?run|paye|net\s?pay|monthly\s?pay|remuneration)\b/i;

/**
 * Does this credit look like a salary? Deliberately conservative — a false
 * positive means a payday push on the wrong day, which is noise.
 */
export function isSalaryLike(input: {
  amount: number;
  description?: string | null;
  merchantName?: string | null;
  categorySlug?: string | null;
}): boolean {
  if (input.amount < 50_000) return false;
  if (input.categorySlug === "salary") return true;
  const haystack = `${input.description ?? ""} ${input.merchantName ?? ""}`;
  return SALARY_WORDS.test(haystack);
}

// ------------------------------------------------------------------ context

export async function createIngestContext(): Promise<IngestContext> {
  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const categories = await db.select().from(tables.categories);
  const rules = await db.select().from(tables.rules);

  const categoriesById = new Map<string, CategoryRow>();
  const categoriesBySlug = new Map<string, CategoryRow>();
  for (const c of categories) {
    const row: CategoryRow = {
      id: c.id,
      slug: c.slug,
      name: c.name,
      kind: c.kind,
      isImpulseProne: c.isImpulseProne,
    };
    categoriesById.set(row.id, row);
    categoriesBySlug.set(row.slug, row);
  }

  return {
    timezone: settingsRow?.timezone ?? "Europe/London",
    categoriesById,
    categoriesBySlug,
    rules: rules.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      field: r.field,
      categoryId: r.categoryId,
    })),
    merchantCache: new Map(),
    ruleHits: new Map(),
  };
}

// ---------------------------------------------------------------- merchants

/** Upsert a merchant by its normalised name; returns null for empty names. */
async function resolveMerchant(
  ctx: IngestContext,
  name: string | null | undefined,
  providerMerchantId: string | null | undefined,
  logoUrl: string | null | undefined,
): Promise<MerchantRef | null> {
  const display = (name ?? "").trim();
  if (!display) return null;
  const normalised = normaliseMerchant(display);
  if (!normalised) return null;

  const cached = ctx.merchantCache.get(normalised);
  if (cached) return cached;

  const [row] = await db
    .insert(tables.merchants)
    .values({
      normalisedName: normalised,
      displayName: display,
      monzoMerchantId: providerMerchantId ?? null,
      logoUrl: logoUrl ?? null,
    })
    .onConflictDoUpdate({
      target: tables.merchants.normalisedName,
      set: {
        monzoMerchantId: dsql`coalesce(${tables.merchants.monzoMerchantId}, excluded.monzo_merchant_id)`,
        logoUrl: dsql`coalesce(${tables.merchants.logoUrl}, excluded.logo_url)`,
      },
    })
    .returning({ id: tables.merchants.id, categoryId: tables.merchants.categoryId });

  const ref: MerchantRef = { id: row.id, categoryId: row.categoryId };
  ctx.merchantCache.set(normalised, ref);
  return ref;
}

// -------------------------------------------------------------------- rules

function matchRule(
  ctx: IngestContext,
  description: string,
  merchantName: string | null,
): string | null {
  const description_ = description.toLowerCase();
  const merchant = (merchantName ?? "").toLowerCase();
  for (const rule of ctx.rules) {
    const haystack = rule.field === "description" ? description_ : merchant;
    const needle = rule.pattern.trim().toLowerCase();
    if (!haystack || !needle) continue;
    if (haystack.includes(needle)) {
      ctx.ruleHits.set(rule.id, (ctx.ruleHits.get(rule.id) ?? 0) + 1);
      return rule.categoryId;
    }
  }
  return null;
}

async function flushRuleHits(ctx: IngestContext): Promise<void> {
  for (const [ruleId, hits] of ctx.ruleHits) {
    await db
      .update(tables.rules)
      .set({ hits: dsql`${tables.rules.hits} + ${hits}` })
      .where(eq(tables.rules.id, ruleId));
  }
  ctx.ruleHits.clear();
}

// ------------------------------------------------------------------- ingest

/**
 * Upsert a batch of provider transactions into one account.
 * Idempotent: safe to replay the same page as often as you like.
 */
export async function ingestTransactions(
  accountId: string,
  inputs: IngestInput[],
  context?: IngestContext,
): Promise<IngestSummary> {
  const ctx = context ?? (await createIngestContext());
  const rows: IngestedRow[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let earliest: Date | null = null;

  for (const input of inputs) {
    // active card checks come through as £0 — never spending
    if (!Number.isFinite(input.amount) || Math.round(input.amount) === 0) {
      skipped += 1;
      continue;
    }
    const amount = Math.round(input.amount);
    const postedAt = input.postedAt;
    if (!(postedAt instanceof Date) || Number.isNaN(postedAt.getTime())) {
      skipped += 1;
      continue;
    }

    const description = (input.description ?? "").trim();
    const merchantName = (input.merchantName ?? "").trim() || null;

    const merchant = await resolveMerchant(
      ctx,
      merchantName,
      input.providerMerchantId,
      input.merchantLogo,
    );

    // free categorisation, cheapest signal first
    let categoryId: string | null = null;
    let categorySource: "merchant" | "rule" | "provider" | null = null;

    if (merchant?.categoryId) {
      categoryId = merchant.categoryId;
      categorySource = "merchant";
    }
    if (!categoryId) {
      const ruleCategory = matchRule(ctx, description, merchantName);
      if (ruleCategory) {
        categoryId = ruleCategory;
        categorySource = "rule";
      }
    }
    if (!categoryId) {
      const slug = mapProviderCategory(input.providerCategory);
      const direct = slugifyCategory(input.providerCategory);
      const mapped =
        (slug ? ctx.categoriesBySlug.get(slug) : undefined) ??
        (direct ? ctx.categoriesBySlug.get(direct) : undefined);
      if (mapped) {
        categoryId = mapped.id;
        categorySource = "provider";
      }
    }

    const dedupeKey = dedupeKeyForDate(
      postedAt,
      amount,
      merchantName ?? description,
      ctx.timezone,
    );

    const [result] = await db
      .insert(tables.transactions)
      .values({
        accountId,
        providerTxId: input.providerTxId,
        postedAt,
        settledAt: input.settledAt ?? null,
        amount,
        currency: input.currency ?? "GBP",
        description,
        merchantId: merchant?.id ?? null,
        categoryId,
        categorySource,
        notes: input.notes ?? null,
        dedupeKey,
        declined: input.declined ?? false,
        raw: input.raw ?? null,
      })
      .onConflictDoUpdate({
        target: [tables.transactions.accountId, tables.transactions.providerTxId],
        set: {
          // pending → settled changes these; everything else is left alone so a
          // manual recategorisation is never trampled by a re-sync
          amount: dsql`excluded.amount`,
          settledAt: dsql`excluded.settled_at`,
          declined: dsql`excluded.declined`,
          description: dsql`excluded.description`,
          dedupeKey: dsql`excluded.dedupe_key`,
          merchantId: dsql`coalesce(${tables.transactions.merchantId}, excluded.merchant_id)`,
          categoryId: dsql`coalesce(${tables.transactions.categoryId}, excluded.category_id)`,
          categorySource: dsql`coalesce(${tables.transactions.categorySource}, excluded.category_source)`,
          raw: dsql`coalesce(excluded.raw, ${tables.transactions.raw})`,
        },
      })
      .returning({
        id: tables.transactions.id,
        // xmax is 0 on a fresh insert, non-zero on the update path
        isNew: dsql<boolean>`(xmax::text::bigint = 0)`,
      });

    const category = categoryId ? ctx.categoriesById.get(categoryId) : undefined;
    const isNew = Boolean(result?.isNew);
    if (isNew) inserted += 1;
    else updated += 1;
    if (!earliest || postedAt < earliest) earliest = postedAt;

    rows.push({
      id: result.id,
      providerTxId: input.providerTxId,
      isNew,
      amount,
      postedAt,
      description,
      merchantId: merchant?.id ?? null,
      merchantName,
      categorySlug: category?.slug ?? null,
      categoryKind: category?.kind ?? null,
      impulseProne: category?.isImpulseProne ?? false,
      declined: input.declined ?? false,
    });
  }

  await flushRuleHits(ctx);
  return { rows, inserted, updated, skipped, earliest };
}

// -------------------------------------------------------- provider adapters

/** Monzo's transaction payload → the shape ingest wants. */
export function fromMonzoTransaction(tx: MonzoTransactionRaw): IngestInput {
  const merchant =
    tx.merchant && typeof tx.merchant === "object" ? (tx.merchant as MonzoMerchantRaw) : null;
  const merchantId =
    merchant?.id ?? (typeof tx.merchant === "string" && tx.merchant ? tx.merchant : null);
  const settled = tx.settled ? new Date(tx.settled) : null;

  return {
    providerTxId: tx.id,
    postedAt: new Date(tx.created),
    settledAt: settled && !Number.isNaN(settled.getTime()) ? settled : null,
    amount: tx.amount,
    currency: tx.currency ?? "GBP",
    description: tx.description ?? "",
    merchantName: merchant?.name ?? tx.description ?? null,
    providerMerchantId: merchantId,
    merchantLogo: merchant?.logo ?? null,
    providerCategory: tx.category ?? merchant?.category ?? null,
    declined: Boolean(tx.decline_reason),
    notes: tx.notes?.trim() ? tx.notes : null,
    raw: tx as unknown as Record<string, unknown>,
  };
}

// ----------------------------------------------------------------- accounts

export interface AccountUpsert {
  provider: Provider;
  providerAccountId: string;
  name: string;
  type?: string | null;
  currency?: string | null;
  isPrimary?: boolean;
  closed?: boolean;
}

/** Upsert one account row, returning its local id. */
export async function upsertAccount(input: AccountUpsert): Promise<string> {
  const [row] = await db
    .insert(tables.accounts)
    .values({
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      name: input.name,
      type: input.type ?? null,
      currency: input.currency ?? "GBP",
      isPrimary: input.isPrimary ?? false,
      closed: input.closed ?? false,
    })
    .onConflictDoUpdate({
      target: [tables.accounts.provider, tables.accounts.providerAccountId],
      set: {
        name: dsql`excluded.name`,
        type: dsql`coalesce(excluded.type, ${tables.accounts.type})`,
        currency: dsql`excluded.currency`,
        isPrimary: dsql`excluded.is_primary`,
        closed: dsql`excluded.closed`,
      },
    })
    .returning({ id: tables.accounts.id });
  return row.id;
}

export type AccountRow = typeof tables.accounts.$inferSelect;

/** Local mirror rows for one provider's live accounts. */
export async function providerAccounts(provider: Provider): Promise<AccountRow[]> {
  return db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.provider, provider), eq(tables.accounts.closed, false)));
}

/**
 * Backfill transaction categories from their merchant, for rows the nightly
 * batch has since taught us about. Returns the number of rows touched.
 */
export async function backfillCategoriesFromMerchants(merchantIds?: string[]): Promise<number> {
  const filters = [
    isNull(tables.transactions.categoryId),
    dsql`${tables.transactions.merchantId} is not null`,
  ];
  if (merchantIds && merchantIds.length > 0) {
    filters.push(inArray(tables.transactions.merchantId, merchantIds));
  }

  const result = await db
    .update(tables.transactions)
    .set({
      categoryId: dsql`${tables.merchants.categoryId}`,
      categorySource: "merchant",
    })
    .from(tables.merchants)
    .where(
      and(
        eq(tables.transactions.merchantId, tables.merchants.id),
        dsql`${tables.merchants.categoryId} is not null`,
        ...filters,
      ),
    )
    .returning({ id: tables.transactions.id });

  return result.length;
}
