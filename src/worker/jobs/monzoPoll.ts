import { desc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { enqueue } from "@/lib/boss";
import {
  createIngestContext,
  fromMonzoTransaction,
  ingestTransactions,
  isSalaryLike,
  providerAccounts,
  type AccountRow,
  type IngestContext,
  type IngestedRow,
} from "@/lib/finance/ingest";
import * as monzo from "@/lib/providers/monzo";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// Every three minutes (and immediately on a webhook). Cheap by design: ask for
// everything since the newest row we hold, minus an hour of overlap so nothing
// slips through a boundary, then let the ingest upsert absorb the duplicates.

const OVERLAP_MS = 60 * 60 * 1000;
const COLD_START_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 40;

/** Big spends in an impulse-prone category get a gentle check-in, 30 min later. */
const IMPULSE_THRESHOLD_PENCE = -2000;
const IMPULSE_DELAY_SECONDS = 1800;
const SALARY_THRESHOLD_PENCE = 50_000;

// pg-boss can hand the cron and a webhook nudge to the same process at once;
// one poll at a time is plenty.
let running = false;

async function pollAccount(account: AccountRow, ctx: IngestContext): Promise<IngestedRow[]> {
  const [newest] = await db
    .select({ postedAt: tables.transactions.postedAt })
    .from(tables.transactions)
    .where(eq(tables.transactions.accountId, account.id))
    .orderBy(desc(tables.transactions.postedAt))
    .limit(1);

  const from = newest?.postedAt
    ? new Date(newest.postedAt.getTime() - OVERLAP_MS)
    : new Date(Date.now() - COLD_START_MS);

  let since: string = monzo.rfc3339(from);
  const rows: IngestedRow[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await monzo.listTransactions({
      accountId: account.providerAccountId,
      since,
      limit: PAGE_SIZE,
    });
    if (batch.length === 0) break;

    const summary = await ingestTransactions(account.id, batch.map(fromMonzoTransaction), ctx);
    rows.push(...summary.rows);

    since = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

const monzoPoll: JobDefinition = {
  queue: QUEUES.monzoPoll,
  schedule: { cron: "*/3 * * * *" },
  handler: async () => {
    if (running) {
      console.log("[monzoPoll] already polling — skipping this tick");
      return;
    }
    if (!(await monzo.isConnected())) return;

    // per-account opt-out from Settings; the row stays listed either way
    const accounts = (await providerAccounts("monzo")).filter((a) => a.syncEnabled !== false);
    if (accounts.length === 0) return; // backfill hasn't landed yet

    running = true;
    try {
      const ctx = await createIngestContext();
      const rows: IngestedRow[] = [];
      for (const account of accounts) {
        rows.push(...(await pollAccount(account, ctx)));
      }

      await monzo.refreshBalancesAndPots();

      // Only genuinely new, live spend triggers anything downstream — a
      // pending row settling must never fire a second check-in.
      for (const row of rows) {
        if (!row.isNew || row.declined) continue;

        if (
          row.amount <= IMPULSE_THRESHOLD_PENCE &&
          row.impulseProne &&
          row.categoryKind !== "transfer"
        ) {
          await enqueue(
            QUEUES.impulseCheck,
            { transactionId: row.id },
            { startAfter: IMPULSE_DELAY_SECONDS, singletonKey: `impulse-${row.id}` },
          );
        }

        if (
          row.amount >= SALARY_THRESHOLD_PENCE &&
          isSalaryLike({
            amount: row.amount,
            description: row.description,
            merchantName: row.merchantName,
            categorySlug: row.categorySlug,
          })
        ) {
          await enqueue(QUEUES.paydayDetect, {}, { singletonKey: "poll" });
        }
      }
    } catch (err) {
      // Not approved in the app yet, or the token lapsed — tokenWatch nudges
      // about the latter; either way a failed poll must not spam the log.
      if (err instanceof monzo.MonzoForbiddenError || err instanceof monzo.MonzoNotConnectedError) {
        console.log(`[monzoPoll] skipped: ${err.message}`);
        return;
      }
      throw err;
    } finally {
      running = false;
    }
  },
};

export default monzoPoll;
