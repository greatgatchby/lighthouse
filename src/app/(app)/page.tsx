import Link from "next/link";
import { desc, eq, inArray, isNull } from "drizzle-orm";
import { db, tables } from "@/db";
import { EnergyCheckIn } from "@/components/EnergyCheckIn";
import { Card, EmptyState, Pill, SectionTitle } from "@/components/ui";
import { safeToSpend } from "@/lib/finance/safeToSpend";
import { formatMoney, localDay } from "@/lib/format";
import { rankGoals } from "@/lib/goals/rank";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const timezone = settingsRow?.timezone ?? "Europe/London";
  const energy = settingsRow?.energy ?? "medium";
  const today = localDay(new Date(), timezone);

  const [digest] = await db
    .select()
    .from(tables.digests)
    .where(eq(tables.digests.forDate, today))
    .limit(1);

  const sts = await safeToSpend();

  const openGoals = await db
    .select()
    .from(tables.goals)
    .where(inArray(tables.goals.status, ["active", "spark"]));
  const ranked = rankGoals(openGoals, energy).slice(0, 4);

  const sparkCount = (
    await db
      .select({ id: tables.sparks.id })
      .from(tables.sparks)
      .where(isNull(tables.sparks.dismissedAt))
  ).length;

  const recentTx = await db
    .select({
      description: tables.transactions.description,
      amount: tables.transactions.amount,
      postedAt: tables.transactions.postedAt,
    })
    .from(tables.transactions)
    .orderBy(desc(tables.transactions.postedAt))
    .limit(3);

  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(new Date())}
        </h1>
      </header>

      <EnergyCheckIn current={energy} />

      {digest ? (
        <Card accent className="mt-4">
          <p className="text-base leading-relaxed text-(--color-bright)">{digest.content.headline}</p>
          {digest.content.whatMatters.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {digest.content.whatMatters.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-(--color-mist)">
                  <span className="text-(--color-beacon)">•</span>
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-sm text-(--color-fog)">{digest.content.moneyNote}</p>
        </Card>
      ) : null}

      <SectionTitle
        action={
          <Link href="/money" className="text-xs text-(--color-beacon)">
            Money →
          </Link>
        }
      >
        Safe to spend today
      </SectionTitle>
      <Card>
        {sts.hasData ? (
          <div className="text-center">
            <div className="text-5xl font-bold tabular-nums tracking-tight">
              {formatMoney(sts.perDay)}
            </div>
            <div className="mt-1 text-sm text-(--color-fog)">
              {sts.daysToPayday} day{sts.daysToPayday === 1 ? "" : "s"} to payday ·{" "}
              {formatMoney(sts.committed)} committed
            </div>
          </div>
        ) : (
          <p className="py-2 text-center text-sm text-(--color-fog)">
            Connect Monzo in Settings and this becomes one calm number.
          </p>
        )}
      </Card>

      <SectionTitle
        action={
          <Link href="/goals" className="text-xs text-(--color-beacon)">
            All goals →
          </Link>
        }
      >
        Doable right now
      </SectionTitle>
      {ranked.length > 0 ? (
        <div className="space-y-2">
          {ranked.map((goal) => (
            <Link key={goal.id} href={`/goals/${goal.id}`} className="block">
              <Card className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{goal.title}</div>
                  {goal.nextAction ? (
                    <div className="mt-0.5 truncate text-sm text-(--color-fog)">
                      → {goal.nextAction}
                    </div>
                  ) : null}
                </div>
                <Pill tone={goal.status === "spark" ? "beacon" : "sea"}>
                  {goal.status === "spark" ? "spark" : `${"⚡".repeat(Math.min(goal.excitement, 3))}`}
                </Pill>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="✨"
          title="No goals yet"
          hint="Capture a spark in Goals — structure comes later, never at capture."
        />
      )}

      {sparkCount > 0 ? (
        <Link href="/goals?tab=sparks" className="mt-3 block">
          <Card className="flex items-center justify-between">
            <span className="text-sm text-(--color-mist)">Sparks waiting in the inbox</span>
            <Pill tone="beacon">{sparkCount}</Pill>
          </Card>
        </Link>
      ) : null}

      {recentTx.length > 0 ? (
        <>
          <SectionTitle>Latest money</SectionTitle>
          <Card className="divide-y divide-(--color-card-edge)">
            {recentTx.map((tx, i) => (
              <div key={i} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                <span className="truncate pr-3 text-sm text-(--color-mist)">{tx.description}</span>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatMoney(tx.amount, { sign: true, showPence: true })}
                </span>
              </div>
            ))}
          </Card>
        </>
      ) : null}
    </main>
  );
}
