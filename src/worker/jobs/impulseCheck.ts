import { and, eq, gte, isNull, ne, sql as dsql } from "drizzle-orm";
import { db, tables } from "@/db";
import { formatMoney } from "@/lib/format";
import { sendPush } from "@/lib/push";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// Half an hour after a bigger buy in an impulse-prone category, one question,
// asked once. Not "should you have?" — "are you happy?". Every answer is a
// fine answer, and answering at all is the useful part.
//
// No cron: monzo-poll schedules these with startAfter.

const impulseCheck: JobDefinition = {
  queue: QUEUES.impulseCheck,
  handler: async (jobs) => {
    for (const job of jobs) {
      const { transactionId } = (job.data ?? {}) as { transactionId?: string };
      if (!transactionId) continue;

      const [row] = await db
        .select({
          id: tables.transactions.id,
          amount: tables.transactions.amount,
          postedAt: tables.transactions.postedAt,
          description: tables.transactions.description,
          declined: tables.transactions.declined,
          supersededBy: tables.transactions.supersededBy,
          merchantId: tables.transactions.merchantId,
          merchantName: tables.merchants.displayName,
        })
        .from(tables.transactions)
        .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
        .where(eq(tables.transactions.id, transactionId))
        .limit(1);

      if (!row || row.declined || row.supersededBy) continue;
      if (row.amount >= 0) continue;

      // already handed back? then there's nothing to sit with
      const spent = Math.abs(row.amount);
      const [refund] = await db
        .select({ id: tables.transactions.id })
        .from(tables.transactions)
        .where(
          and(
            isNull(tables.transactions.supersededBy),
            eq(tables.transactions.declined, false),
            ne(tables.transactions.id, row.id),
            gte(tables.transactions.postedAt, row.postedAt),
            row.merchantId
              ? eq(tables.transactions.merchantId, row.merchantId)
              : eq(tables.transactions.description, row.description),
            dsql`${tables.transactions.amount} >= ${Math.round(spent * 0.9)}`,
          ),
        )
        .limit(1);
      if (refund) continue;

      const merchant = row.merchantName ?? row.description ?? "that one";

      await sendPush({
        title: "Quick check-in",
        body: `Bought ${merchant} for ${formatMoney(spent)}. Happy with it?`,
        url: `/money/impulse?tx=${row.id}`,
        tag: `impulse-${row.id}`,
        category: "impulse",
        actions: [
          { action: "happy", title: "Yes 😊" },
          { action: "returning", title: "Returning it" },
          { action: "reflect", title: "Reflect" },
        ],
        data: { transactionId: row.id },
      });
    }
  },
};

export default impulseCheck;
