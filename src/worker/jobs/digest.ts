import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq, gte, isNull, ne, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { claude, logUsage, MODEL } from "@/lib/claude/client";
import { safeToSpend } from "@/lib/finance/safeToSpend";
import { formatMoney, localDay } from "@/lib/format";
import { sendPush } from "@/lib/push";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// Morning digest: composes today's "Today" card — what matters, one exciting
// goal, one money note, one nudge — then pushes it (sendPush parks it until
// quiet hours end).

const DigestSchema = z.object({
  headline: z.string().describe("one warm sentence to open the day, no exclamation marks"),
  whatMatters: z.array(z.string()).max(3).describe("up to 3 short concrete items"),
  excitingGoal: z
    .object({
      goalId: z.string().nullable(),
      text: z.string().describe("why this goal is worth touching today, one sentence"),
    })
    .nullable(),
  moneyNote: z.string().describe("one calm money observation — a win to claim, never a scold"),
  nudge: z.string().describe("one tiny doable action for a low-energy moment"),
});

const digest: JobDefinition = {
  queue: QUEUES.digest,
  schedule: { cron: "45 6 * * *" },
  handler: async () => {
    const [settingsRow] = await db.select().from(tables.settings).limit(1);
    const timezone = settingsRow?.timezone ?? "Europe/London";
    const today = localDay(new Date(), timezone);

    const [already] = await db
      .select({ id: tables.digests.id })
      .from(tables.digests)
      .where(eq(tables.digests.forDate, today))
      .limit(1);
    if (already) return;

    const sts = await safeToSpend();

    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const spendByCategory = await db
      .select({
        category: tables.categories.name,
        total: dsql<number>`sum(-${tables.transactions.amount})::int`,
      })
      .from(tables.transactions)
      .leftJoin(tables.categories, eq(tables.transactions.categoryId, tables.categories.id))
      .where(
        and(
          gte(tables.transactions.postedAt, weekAgo),
          isNull(tables.transactions.supersededBy),
          eq(tables.transactions.declined, false),
          dsql`${tables.transactions.amount} < 0`,
        ),
      )
      .groupBy(tables.categories.name)
      .orderBy(desc(dsql`sum(-${tables.transactions.amount})`))
      .limit(8);

    const activeGoals = await db
      .select()
      .from(tables.goals)
      .where(ne(tables.goals.status, "done"))
      .orderBy(desc(tables.goals.excitement))
      .limit(12);

    const expiring = await db
      .select({
        title: tables.documents.title,
        docType: tables.documents.docType,
        expiresAt: tables.documents.expiresAt,
      })
      .from(tables.documents)
      .where(
        and(
          gte(tables.documents.expiresAt, today),
          dsql`${tables.documents.expiresAt} <= (${today}::date + interval '30 days')`,
        ),
      )
      .limit(5);

    const graveyard = await db
      .select({ name: tables.recurring.name, amount: tables.recurring.amount })
      .from(tables.recurring)
      .where(eq(tables.recurring.status, "graveyard"))
      .limit(5);

    const facts = {
      safeToSpendToday: sts.hasData ? formatMoney(sts.perDay) : "unknown (no accounts yet)",
      daysToPayday: sts.daysToPayday,
      weekSpendByCategory: spendByCategory.map((r) => ({
        category: r.category ?? "uncategorised",
        spentPence: r.total ?? 0,
      })),
      goals: activeGoals.map((g) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        excitement: g.excitement,
        nextAction: g.nextAction,
        energyRequired: g.energyRequired,
      })),
      expiringDocuments: expiring,
      forgottenSubscriptions: graveyard,
      currentEnergy: settingsRow?.energy ?? "medium",
    };

    const response = await claude().messages.parse({
      model: MODEL,
      max_tokens: 2048,
      system:
        "You compose a tiny morning digest for one person with an ADHD brain, inside their private life app. Interest-driven, never guilt-driven; money notes are framed as wins to claim; every suggested action is one small concrete sentence. Use only the facts given.",
      messages: [
        {
          role: "user",
          content: `Compose today's digest (${today}) from these facts:\n${JSON.stringify(facts, null, 2)}`,
        },
      ],
      output_config: { format: zodOutputFormat(DigestSchema) },
    });
    await logUsage("digest", response.usage);

    const content = response.parsed_output;
    if (!content) throw new Error("digest: model returned unparseable output");

    await db
      .insert(tables.digests)
      .values({ forDate: today, content })
      .onConflictDoNothing();

    await sendPush({
      title: "Good morning",
      body: content.headline,
      url: "/",
      tag: "daily-digest",
      category: "digest",
    });
  },
};

export default digest;
