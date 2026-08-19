import { and, asc, eq, gte, isNull, sql as dsql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { localMonthStart } from "@/lib/finance/ingest";
import { safeToSpend } from "@/lib/finance/safeToSpend";

// The money screen's single fetch: one calm number, the accounts and pots
// behind it, and where this calendar month has gone so far.
// Live rows only (superseded_by IS NULL) — Lunchflow twins never double-count.

export const dynamic = "force-dynamic";

const UNCATEGORISED = { slug: "uncategorised", name: "Uncategorised" };

export async function GET() {
  await requireUserId();

  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const timezone = settingsRow?.timezone ?? "Europe/London";
  const monthStart = localMonthStart(timezone);

  const [sts, accountRows, potRows, monthRows] = await Promise.all([
    safeToSpend(),
    db
      .select()
      .from(tables.accounts)
      .where(eq(tables.accounts.closed, false))
      .orderBy(asc(tables.accounts.createdAt)),
    db
      .select()
      .from(tables.pots)
      .where(eq(tables.pots.deleted, false))
      .orderBy(asc(tables.pots.name)),
    db
      .select({
        slug: tables.categories.slug,
        name: tables.categories.name,
        kind: tables.categories.kind,
        impulse: tables.categories.isImpulseProne,
        budget: tables.budgets.monthlyLimit,
        spent: dsql<number>`coalesce(sum(case when ${tables.transactions.amount} < 0 then -${tables.transactions.amount} else 0 end), 0)::int`,
        received: dsql<number>`coalesce(sum(case when ${tables.transactions.amount} > 0 then ${tables.transactions.amount} else 0 end), 0)::int`,
      })
      .from(tables.transactions)
      .leftJoin(tables.categories, eq(tables.transactions.categoryId, tables.categories.id))
      .leftJoin(tables.budgets, eq(tables.budgets.categoryId, tables.categories.id))
      .where(
        and(
          isNull(tables.transactions.supersededBy),
          eq(tables.transactions.declined, false),
          gte(tables.transactions.postedAt, monthStart),
        ),
      )
      .groupBy(
        tables.categories.slug,
        tables.categories.name,
        tables.categories.kind,
        tables.categories.isImpulseProne,
        tables.budgets.monthlyLimit,
      ),
  ]);

  // Pot deposits and internal moves are not spending — counting them would make
  // a good month look like a bad one.
  const real = monthRows.filter((row) => row.kind !== "transfer");

  const spentByCategory = real
    .filter((row) => Number(row.spent) > 0)
    .map((row) => ({
      slug: row.slug ?? UNCATEGORISED.slug,
      name: row.name ?? UNCATEGORISED.name,
      spentPence: Number(row.spent),
      budgetPence: row.budget ?? null,
      impulse: row.impulse ?? false,
    }))
    .sort((a, b) => b.spentPence - a.spentPence);

  const totalSpentPence = real.reduce((sum, row) => sum + Number(row.spent), 0);
  const totalInPence = real.reduce((sum, row) => sum + Number(row.received), 0);

  return NextResponse.json({
    safeToSpend: sts,
    accounts: accountRows.map((a) => ({
      id: a.id,
      name: a.name,
      provider: a.provider,
      balance: a.balance,
      isPrimary: a.isPrimary,
    })),
    pots: potRows.map((p) => ({
      id: p.id,
      name: p.name,
      balance: p.balance,
      goalAmount: p.goalAmount ?? null,
    })),
    month: { spentByCategory, totalSpentPence, totalInPence },
  });
}
