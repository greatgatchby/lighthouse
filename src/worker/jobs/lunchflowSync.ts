import { and, eq, gte, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, tables } from "@/db";
import { dedupeCandidateKeys } from "@/lib/dedupe";
import { createIngestContext, ingestTransactions, upsertAccount } from "@/lib/finance/ingest";
import * as lunchflow from "@/lib/providers/lunchflow";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// Lunchflow is the long-term memory behind Monzo's rolling 90 days — and it
// sees other banks too. Nightly, quietly, at 2:30am.
//
// Monzo is always canonical. Where a Lunchflow row is the same purchase as a
// Monzo row, the Lunchflow row is marked superseded_by the Monzo one, so every
// live query (which filters superseded_by IS NULL) counts it exactly once.
// The partial unique index on superseded_by keeps that pairing one-to-one.

const PAIRING_WINDOW_DAYS = 180;

async function pairWithMonzo(timezone: string): Promise<number> {
  const cutoff = new Date(Date.now() - PAIRING_WINDOW_DAYS * 86_400_000);

  const candidates = await db
    .select({
      id: tables.transactions.id,
      postedAt: tables.transactions.postedAt,
      amount: tables.transactions.amount,
      description: tables.transactions.description,
      merchant: tables.merchants.displayName,
    })
    .from(tables.transactions)
    .innerJoin(tables.accounts, eq(tables.transactions.accountId, tables.accounts.id))
    .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
    .where(
      and(
        eq(tables.accounts.provider, "lunchflow"),
        isNull(tables.transactions.supersededBy),
        gte(tables.transactions.postedAt, cutoff),
      ),
    );

  let paired = 0;

  for (const row of candidates) {
    const keys = dedupeCandidateKeys(
      row.postedAt,
      row.amount,
      row.merchant ?? row.description,
      timezone,
    );
    if (keys.length === 0) continue;

    const [twin] = await db
      .select({ id: tables.transactions.id })
      .from(tables.transactions)
      .innerJoin(tables.accounts, eq(tables.transactions.accountId, tables.accounts.id))
      .where(
        and(
          eq(tables.accounts.provider, "monzo"),
          isNull(tables.transactions.supersededBy),
          eq(tables.transactions.amount, row.amount),
          inArray(tables.transactions.dedupeKey, keys),
          // a canonical row absorbs at most one twin
          dsql`not exists (select 1 from transactions absorbed where absorbed.superseded_by = ${tables.transactions.id})`,
        ),
      )
      .limit(1);

    if (!twin) continue;

    try {
      await db
        .update(tables.transactions)
        .set({ supersededBy: twin.id })
        .where(eq(tables.transactions.id, row.id));
      paired += 1;
    } catch {
      // another row claimed this twin first (unique index) — leave both live
    }
  }

  return paired;
}

const lunchflowSync: JobDefinition = {
  queue: QUEUES.lunchflowSync,
  schedule: { cron: "30 2 * * *" },
  handler: async () => {
    if (!lunchflow.isEnabled()) {
      console.log("[lunchflowSync] no LUNCHFLOW_API_KEY — skipping");
      return;
    }

    const ctx = await createIngestContext();
    let imported = 0;
    let accountCount = 0;
    let skipped = 0;

    try {
      const accounts = await lunchflow.listAccounts();
      accountCount = accounts.length;

      for (const account of accounts) {
        const accountId = await upsertAccount({
          provider: "lunchflow",
          providerAccountId: account.id,
          name: account.name,
          currency: account.currency ?? "GBP",
        });

        if (account.balancePence !== null) {
          await db
            .update(tables.accounts)
            .set({ balance: account.balancePence, balanceUpdatedAt: new Date() })
            .where(eq(tables.accounts.id, accountId));
        }

        // Per-account opt-out from Settings. The account row is still upserted
        // above so it stays listed and switchable — only its transactions are
        // skipped.
        const [{ syncEnabled }] = await db
          .select({ syncEnabled: tables.accounts.syncEnabled })
          .from(tables.accounts)
          .where(eq(tables.accounts.id, accountId))
          .limit(1);
        if (!syncEnabled) {
          skipped += 1;
          continue;
        }

        const transactions = await lunchflow.listTransactions(account.id);
        const summary = await ingestTransactions(
          accountId,
          transactions.map((tx) => ({
            providerTxId: tx.id,
            postedAt: tx.postedAt,
            amount: tx.amountPence,
            description: tx.description,
            merchantName: tx.merchantName ?? tx.description,
            providerCategory: tx.categoryHint,
            declined: tx.declined,
            raw: tx.raw,
          })),
          ctx,
        );
        imported += summary.inserted;
      }

      await lunchflow.markConnectionState("active");
    } catch (err) {
      await lunchflow.markConnectionState("error");
      throw err;
    }

    const paired = await pairWithMonzo(ctx.timezone);

    await db.insert(tables.auditLog).values({
      kind: "lunchflow:sync",
      detail: { accounts: accountCount, skipped, imported, paired },
    });
  },
};

export default lunchflowSync;
