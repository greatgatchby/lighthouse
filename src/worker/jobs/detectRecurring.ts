import { and, eq, gte, isNull, lt, notInArray } from "drizzle-orm";
import { db, tables } from "@/db";
import { isSalaryLike, localDayOfMonth } from "@/lib/finance/ingest";
import { normaliseMerchant } from "@/lib/format";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// What leaves on a rhythm: subscriptions, bills, standing charges — and the
// ones that quietly kept going after you stopped using them.
//
// The graveyard is never framed as a mistake. It's money on the table.
// "dismissed" and "cancelled" are human decisions and are never overwritten.

const LOOKBACK_DAYS = 365;
const AMOUNT_TOLERANCE = 0.15;
const MIN_OCCURRENCES = 3;
const GRAVEYARD_PERIODS = 1.5;
const SALARY_MIN_PENCE = 50_000;

type Cadence = "weekly" | "monthly" | "yearly" | "unknown";

const CADENCE_BANDS: { cadence: Cadence; min: number; max: number; days: number }[] = [
  { cadence: "weekly", min: 6, max: 8, days: 7 },
  { cadence: "monthly", min: 25, max: 35, days: 30.5 },
  { cadence: "yearly", min: 350, max: 380, days: 365 },
];

interface Occurrence {
  postedAt: Date;
  amount: number;
  merchantId: string | null;
  name: string;
  categorySlug: string | null;
  description: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function gapsInDays(dates: Date[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    gaps.push((dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000);
  }
  return gaps;
}

function classify(gaps: number[]): { cadence: Cadence; periodDays: number } | null {
  if (gaps.length === 0) return null;
  let best: { cadence: Cadence; periodDays: number; ratio: number } | null = null;

  for (const band of CADENCE_BANDS) {
    const hits = gaps.filter((gap) => gap >= band.min && gap <= band.max).length;
    const ratio = hits / gaps.length;
    if (hits >= 2 && ratio >= 0.6 && (!best || ratio > best.ratio)) {
      const matching = gaps.filter((gap) => gap >= band.min && gap <= band.max);
      best = { cadence: band.cadence, periodDays: median(matching) || band.days, ratio };
    }
  }
  return best ? { cadence: best.cadence, periodDays: best.periodDays } : null;
}

function kindFor(amount: number, categorySlug: string | null): "subscription" | "bill" | "income" {
  if (amount > 0) return "income";
  if (categorySlug === "bills" || categorySlug === "rent-mortgage") return "bill";
  return "subscription";
}

const detectRecurring: JobDefinition = {
  queue: QUEUES.detectRecurring,
  schedule: { cron: "15 3 * * *" },
  handler: async () => {
    const [settingsRow] = await db.select().from(tables.settings).limit(1);
    const timezone = settingsRow?.timezone ?? "Europe/London";
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const now = new Date();

    const rows = await db
      .select({
        postedAt: tables.transactions.postedAt,
        amount: tables.transactions.amount,
        description: tables.transactions.description,
        merchantId: tables.transactions.merchantId,
        merchantName: tables.merchants.displayName,
        categorySlug: tables.categories.slug,
        categoryKind: tables.categories.kind,
      })
      .from(tables.transactions)
      .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
      .leftJoin(tables.categories, eq(tables.transactions.categoryId, tables.categories.id))
      .where(
        and(
          isNull(tables.transactions.supersededBy),
          eq(tables.transactions.declined, false),
          gte(tables.transactions.postedAt, since),
        ),
      );

    // Moving money between your own accounts has a rhythm too, and it isn't
    // a subscription — leave transfers out entirely.
    const usable = rows.filter((row) => row.categoryKind !== "transfer");

    const groups = new Map<string, Occurrence[]>();
    for (const row of usable) {
      const name = row.merchantName ?? row.description ?? "Unknown";
      const key = row.merchantId ?? `desc:${normaliseMerchant(row.description ?? name)}`;
      if (!key || key === "desc:") continue;
      const list = groups.get(key) ?? [];
      list.push({
        postedAt: row.postedAt,
        amount: row.amount,
        merchantId: row.merchantId,
        name,
        categorySlug: row.categorySlug,
        description: row.description ?? "",
      });
      groups.set(key, list);
    }

    const touched: string[] = [];

    for (const occurrences of groups.values()) {
      const outgoing = occurrences.filter((o) => o.amount < 0);
      if (outgoing.length < MIN_OCCURRENCES) continue;

      const typical = median(outgoing.map((o) => Math.abs(o.amount)));
      if (typical <= 0) continue;

      const consistent = outgoing
        .filter((o) => Math.abs(Math.abs(o.amount) - typical) <= typical * AMOUNT_TOLERANCE)
        .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
      if (consistent.length < MIN_OCCURRENCES) continue;

      const shape = classify(gapsInDays(consistent.map((o) => o.postedAt)));
      if (!shape) continue;

      const last = consistent[consistent.length - 1];
      const lastSeenAt = last.postedAt;
      const nextExpectedAt = new Date(lastSeenAt.getTime() + shape.periodDays * 86_400_000);
      const graveyardAfter = new Date(
        nextExpectedAt.getTime() + shape.periodDays * GRAVEYARD_PERIODS * 86_400_000,
      );
      const amount = -typical;
      const merchantId = last.merchantId;
      const name = last.name;

      const [existing] = await db
        .select()
        .from(tables.recurring)
        .where(
          merchantId
            ? eq(tables.recurring.merchantId, merchantId)
            : and(eq(tables.recurring.name, name), isNull(tables.recurring.merchantId)),
        )
        .limit(1);

      const detectedStatus: "active" | "graveyard" = now > graveyardAfter ? "graveyard" : "active";
      const shared = {
        merchantId: merchantId ?? null,
        name,
        amount,
        cadence: shape.cadence,
        dayOfMonth:
          shape.cadence === "monthly" ? localDayOfMonth(lastSeenAt, timezone) : null,
        lastSeenAt,
        nextExpectedAt,
        txCount: consistent.length,
        kind: kindFor(amount, last.categorySlug),
      };

      if (existing) {
        // never downgrade a decision someone already made
        const keepStatus = existing.status === "dismissed" || existing.status === "cancelled";
        await db
          .update(tables.recurring)
          .set({ ...shared, status: keepStatus ? existing.status : detectedStatus })
          .where(eq(tables.recurring.id, existing.id));
        touched.push(existing.id);
      } else {
        const [inserted] = await db
          .insert(tables.recurring)
          .values({ ...shared, firstSeenAt: consistent[0].postedAt, status: detectedStatus })
          .returning({ id: tables.recurring.id });
        touched.push(inserted.id);
      }
    }

    // Anything we didn't see this run whose next charge is long overdue has
    // most likely stopped — move it to the graveyard so it can be claimed.
    const staleFilters = [
      eq(tables.recurring.status, "active"),
      lt(tables.recurring.nextExpectedAt, new Date(now.getTime() - 45 * 86_400_000)),
    ];
    await db
      .update(tables.recurring)
      .set({ status: "graveyard" })
      .where(
        touched.length > 0
          ? and(...staleFilters, notInArray(tables.recurring.id, touched))
          : and(...staleFilters),
      );

    // ---- salary: the one income rhythm worth knowing, because payday anchors
    // "safe to spend" and the payday ritual.
    const salaries = usable
      .filter((row) =>
        isSalaryLike({
          amount: row.amount,
          description: row.description,
          merchantName: row.merchantName,
          categorySlug: row.categorySlug,
        }),
      )
      .filter((row) => row.amount >= SALARY_MIN_PENCE)
      .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());

    if (salaries.length >= MIN_OCCURRENCES) {
      const shape = classify(gapsInDays(salaries.map((row) => row.postedAt)));
      if (shape && shape.cadence === "monthly") {
        const days = salaries.map((row) => localDayOfMonth(row.postedAt, timezone));
        const tally = new Map<number, number>();
        for (const day of days) tally.set(day, (tally.get(day) ?? 0) + 1);
        const [payday] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];

        if (settingsRow && settingsRow.paydayDayOfMonth !== payday) {
          await db
            .update(tables.settings)
            .set({ paydayDayOfMonth: payday, updatedAt: new Date() })
            .where(eq(tables.settings.userId, settingsRow.userId));
          await db.insert(tables.auditLog).values({
            kind: "finance:payday_detected",
            detail: { dayOfMonth: payday, samples: salaries.length },
          });
        }
      }
    }

    await db.insert(tables.auditLog).values({
      kind: "finance:recurring_scan",
      detail: { groups: groups.size, detected: touched.length },
    });
  },
};

export default detectRecurring;
