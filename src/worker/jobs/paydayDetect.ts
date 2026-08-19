import { and, eq, gte, isNull, sql as dsql } from "drizzle-orm";
import { db, tables } from "@/db";
import { isSalaryLike, localMonthStart } from "@/lib/finance/ingest";
import { sendPush } from "@/lib/push";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// Payday is the one moment when saving is easy — the money is there and it
// hasn't been spoken for yet. Hourly (and immediately when the poller sees a
// salary-shaped credit), at most once a month.

const WINDOW_MS = 90 * 60 * 1000;
const PUSH_KIND = "payday:push";
const SALARY_MIN_PENCE = 50_000;

const paydayDetect: JobDefinition = {
  queue: QUEUES.paydayDetect,
  schedule: { cron: "0 * * * *" },
  handler: async () => {
    const [settingsRow] = await db.select().from(tables.settings).limit(1);
    const timezone = settingsRow?.timezone ?? "Europe/London";

    const [alreadyThisMonth] = await db
      .select({ id: tables.auditLog.id })
      .from(tables.auditLog)
      .where(
        and(eq(tables.auditLog.kind, PUSH_KIND), gte(tables.auditLog.at, localMonthStart(timezone))),
      )
      .limit(1);
    if (alreadyThisMonth) return;

    const credits = await db
      .select({
        id: tables.transactions.id,
        amount: tables.transactions.amount,
        postedAt: tables.transactions.postedAt,
        description: tables.transactions.description,
        merchantName: tables.merchants.displayName,
        categorySlug: tables.categories.slug,
      })
      .from(tables.transactions)
      .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
      .leftJoin(tables.categories, eq(tables.transactions.categoryId, tables.categories.id))
      .where(
        and(
          isNull(tables.transactions.supersededBy),
          eq(tables.transactions.declined, false),
          gte(tables.transactions.postedAt, new Date(Date.now() - WINDOW_MS)),
          dsql`${tables.transactions.amount} >= ${SALARY_MIN_PENCE}`,
        ),
      );

    const salary = credits.find((row) =>
      isSalaryLike({
        amount: row.amount,
        description: row.description,
        merchantName: row.merchantName,
        categorySlug: row.categorySlug,
      }),
    );
    if (!salary) return;

    await sendPush({
      title: "Payday 🌅",
      body: "Salary's landed. Want to tuck some away while it's fresh?",
      url: "/money/payday",
      tag: "payday",
      category: "payday",
    });

    await db.insert(tables.auditLog).values({
      kind: PUSH_KIND,
      detail: {
        transactionId: salary.id,
        amountPence: salary.amount,
        postedAt: salary.postedAt.toISOString(),
      },
    });
  },
};

export default paydayDetect;
