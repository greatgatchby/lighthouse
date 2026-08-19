import { and, eq, sql as dsql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import * as lunchflow from "@/lib/providers/lunchflow";

// Per-account sync control. Lunchflow exposes every account it can see, and
// you rarely want all of them in here — this lists what's available (live from
// the provider, merged with what we've already stored) and lets each be
// switched on or off.

export interface SyncableAccount {
  provider: "lunchflow" | "monzo" | "csv";
  providerAccountId: string;
  name: string;
  balancePence: number | null;
  syncEnabled: boolean;
  /** null when the account has been discovered but never synced */
  localId: string | null;
  transactionCount: number;
  /** provider is reachable but this account is no longer listed there */
  missingUpstream: boolean;
}

async function localAccounts(provider: "lunchflow" | "monzo") {
  const rows = await db
    .select({
      id: tables.accounts.id,
      providerAccountId: tables.accounts.providerAccountId,
      name: tables.accounts.name,
      balance: tables.accounts.balance,
      syncEnabled: tables.accounts.syncEnabled,
      transactionCount: dsql<number>`(
        select count(*)::int from transactions where transactions.account_id = ${tables.accounts.id}
      )`,
    })
    .from(tables.accounts)
    .where(eq(tables.accounts.provider, provider));
  return rows;
}

export async function GET() {
  await requireUserId();

  const stored = await localAccounts("lunchflow");
  const byProviderId = new Map(stored.map((row) => [row.providerAccountId, row]));

  let upstream: lunchflow.LunchflowAccount[] = [];
  let error: string | null = null;
  let configured = lunchflow.isEnabled();

  if (configured) {
    try {
      upstream = await lunchflow.listAccounts();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const seen = new Set<string>();
  const accounts: SyncableAccount[] = upstream.map((account) => {
    seen.add(account.id);
    const local = byProviderId.get(account.id);
    return {
      provider: "lunchflow",
      providerAccountId: account.id,
      name: account.name || local?.name || "Account",
      balancePence: account.balancePence ?? local?.balance ?? null,
      // Discovered-but-unsaved accounts default to on, so a fresh connection
      // works without a setup gauntlet; switching one off is one tap.
      syncEnabled: local?.syncEnabled ?? true,
      localId: local?.id ?? null,
      transactionCount: local?.transactionCount ?? 0,
      missingUpstream: false,
    };
  });

  // Accounts we've synced before that the provider no longer lists — surfaced
  // rather than hidden, so stale data doesn't sit there unexplained.
  for (const row of stored) {
    if (seen.has(row.providerAccountId)) continue;
    accounts.push({
      provider: "lunchflow",
      providerAccountId: row.providerAccountId,
      name: row.name,
      balancePence: row.balance,
      syncEnabled: row.syncEnabled,
      localId: row.id,
      transactionCount: row.transactionCount,
      missingUpstream: configured && !error,
    });
  }

  accounts.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ configured, error, accounts });
}

/** Toggle one account's sync. Creates the local row if it's never synced. */
export async function PATCH(request: Request) {
  await requireUserId();
  const { providerAccountId, syncEnabled, name } = await request.json();

  if (typeof providerAccountId !== "string" || typeof syncEnabled !== "boolean") {
    return NextResponse.json(
      { error: "providerAccountId and syncEnabled required" },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(tables.accounts)
    .where(
      and(
        eq(tables.accounts.provider, "lunchflow"),
        eq(tables.accounts.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(tables.accounts)
      .set({ syncEnabled })
      .where(eq(tables.accounts.id, existing.id));
    return NextResponse.json({ ok: true, localId: existing.id, syncEnabled });
  }

  const [created] = await db
    .insert(tables.accounts)
    .values({
      provider: "lunchflow",
      providerAccountId,
      name: typeof name === "string" && name ? name : "Lunchflow account",
      syncEnabled,
    })
    .returning({ id: tables.accounts.id });

  return NextResponse.json({ ok: true, localId: created.id, syncEnabled });
}

/**
 * Remove transactions already imported from an account you've switched off.
 * Deliberately explicit and separate from the toggle: turning sync off never
 * deletes anything on its own.
 */
export async function DELETE(request: Request) {
  await requireUserId();
  const { providerAccountId } = await request.json();
  if (typeof providerAccountId !== "string") {
    return NextResponse.json({ error: "providerAccountId required" }, { status: 400 });
  }

  const [account] = await db
    .select()
    .from(tables.accounts)
    .where(
      and(
        eq(tables.accounts.provider, "lunchflow"),
        eq(tables.accounts.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);

  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Any Monzo row this account's transactions were superseding becomes live
  // again automatically — superseded_by lives on the duplicate, not the twin.
  const deleted = await db
    .delete(tables.transactions)
    .where(eq(tables.transactions.accountId, account.id))
    .returning({ id: tables.transactions.id });

  await db.insert(tables.auditLog).values({
    kind: "finance:account_purged",
    detail: { provider: "lunchflow", providerAccountId, deleted: deleted.length },
  });

  return NextResponse.json({ ok: true, deleted: deleted.length });
}
