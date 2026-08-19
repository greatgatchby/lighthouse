import { db, tables } from "@/db";
import {
  createIngestContext,
  fromMonzoTransaction,
  ingestTransactions,
  upsertAccount,
} from "@/lib/finance/ingest";
import * as monzo from "@/lib/providers/monzo";
import { sendPush } from "@/lib/push";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// The five-minute job. Monzo only serves full history for ~5 minutes after
// authorisation; after that it's a rolling 90 days forever. The OAuth callback
// enqueues this at priority 10 and it runs immediately.
//
// The other half of the story is SCA: until the approval prompt is tapped in
// the Monzo app, every call comes back 403. That isn't a failure — it's a
// person walking to their phone — so we sit and retry for six minutes.

const SCA_WINDOW_MS = 6 * 60 * 1000;
const SCA_RETRY_MS = 15 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function accountName(account: monzo.MonzoAccountRaw): string {
  const described = (account.description ?? "").trim();
  if (described) return described;
  if (account.type === "uk_retail") return "Monzo";
  if (account.type === "uk_retail_joint") return "Monzo Joint";
  return account.type ?? "Monzo account";
}

async function runBackfill(): Promise<{ count: number; earliest: Date | null }> {
  const remote = await monzo.listAccounts(); // already filters closed accounts
  const ctx = await createIngestContext();
  let count = 0;
  let earliest: Date | null = null;

  for (const account of remote) {
    const accountId = await upsertAccount({
      provider: "monzo",
      providerAccountId: account.id,
      name: accountName(account),
      type: account.type ?? null,
      currency: account.currency ?? "GBP",
      // the personal current account is where money actually moves from
      isPrimary: account.type === "uk_retail",
      closed: false,
    });

    // page forward: first by the account's own birthday, then by the last id
    // on each page — same-millisecond timestamps make id paging the safe one
    let since: string | undefined = account.created
      ? monzo.rfc3339(new Date(account.created))
      : undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await monzo.listTransactions({
        accountId: account.id,
        since,
        limit: PAGE_SIZE,
      });
      if (batch.length === 0) break;

      const summary = await ingestTransactions(accountId, batch.map(fromMonzoTransaction), ctx);
      count += summary.inserted;
      if (summary.earliest && (!earliest || summary.earliest < earliest)) {
        earliest = summary.earliest;
      }

      since = batch[batch.length - 1].id;
      if (batch.length < PAGE_SIZE) break;
    }
  }

  await monzo.refreshBalancesAndPots();
  return { count, earliest };
}

const monzoBackfill: JobDefinition = {
  queue: QUEUES.monzoBackfill,
  handler: async () => {
    if (!(await monzo.isConnected())) {
      console.log("[monzoBackfill] no Monzo connection yet — nothing to import");
      return;
    }

    const deadline = Date.now() + SCA_WINDOW_MS;
    let result: { count: number; earliest: Date | null };

    for (;;) {
      try {
        result = await runBackfill();
        break;
      } catch (err) {
        const waiting =
          err instanceof monzo.MonzoForbiddenError && Date.now() + SCA_RETRY_MS < deadline;
        if (!waiting) throw err;
        console.log("[monzoBackfill] waiting for in-app approval…");
        await sleep(SCA_RETRY_MS);
      }
    }

    const [settingsRow] = await db.select().from(tables.settings).limit(1);
    const timezone = settingsRow?.timezone ?? "Europe/London";
    const earliestLabel = result.earliest
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(result.earliest)
      : null;

    await db.insert(tables.auditLog).values({
      kind: "monzo:backfill",
      detail: {
        count: result.count,
        earliest: result.earliest ? result.earliest.toISOString() : null,
      },
    });

    try {
      await sendPush({
        title: "Monzo's in",
        body:
          result.count > 0 && earliestLabel
            ? `Imported ${result.count} transactions back to ${earliestLabel}.`
            : "Connected. New transactions will land here as they happen.",
        url: "/money",
        tag: "monzo-backfill",
        category: "money",
      });
    } catch (err) {
      // the import is what matters; a missing VAPID key must not retry it
      console.error("[monzoBackfill] push failed:", err);
    }
  },
};

export default monzoBackfill;
