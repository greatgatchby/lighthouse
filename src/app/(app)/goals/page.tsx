import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { EnergyCheckIn } from "@/components/EnergyCheckIn";
import { GoalCard } from "@/components/goals/GoalCard";
import { ShowupBar } from "@/components/goals/ShowupBar";
import { SparkInbox } from "@/components/goals/SparkInbox";
import { lastLocalDays } from "@/components/goals/days";
import type { Energy } from "@/components/goals/types";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { rankGoals } from "@/lib/goals/rank";

export const dynamic = "force-dynamic";

// Goals, ordered by what you'd actually enjoy touching right now — excitement
// × freshness × how well it matches today's energy. Never by priority: a
// "high-priority" goal you have no appetite for is just a goal you won't start.

/** Un-park. Coming back is free — the excitement clock restarts so a revived
 * goal isn't punished for the months it spent resting. */
async function bringBack(formData: FormData) {
  "use server";
  await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const now = new Date();
  await db
    .update(tables.goals)
    .set({
      status: "active",
      parkedAt: null,
      doneAt: null,
      excitementUpdatedAt: now,
      lastTouchedAt: now,
      updatedAt: now,
    })
    .where(eq(tables.goals.id, id));
  revalidatePath("/goals");
}

/** "Let it rest" — still parked, and the asking clock starts again from today.
 * Nothing is deleted, nothing is judged. */
async function letItRest(formData: FormData) {
  "use server";
  await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const now = new Date();
  await db
    .update(tables.goals)
    .set({ parkedAt: now, updatedAt: now })
    .where(eq(tables.goals.id, id));
  revalidatePath("/goals");
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;

  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const timezone = settingsRow?.timezone ?? "Europe/London";
  const energy: Energy = settingsRow?.energy ?? "medium";

  const days = lastLocalDays(7, timezone);
  const showupRows = await db
    .select({ day: tables.showups.day })
    .from(tables.showups)
    .where(inArray(tables.showups.day, days));
  const shownDays = new Set(showupRows.map((row) => row.day));

  const sparks = await db
    .select({ id: tables.sparks.id, text: tables.sparks.text })
    .from(tables.sparks)
    .where(and(isNull(tables.sparks.dismissedAt), isNull(tables.sparks.convertedGoalId)))
    .orderBy(desc(tables.sparks.capturedAt))
    .limit(50);

  const openGoals = await db
    .select()
    .from(tables.goals)
    .where(inArray(tables.goals.status, ["active", "spark"]));
  const ranked = rankGoals(openGoals, energy);

  const parked = await db
    .select()
    .from(tables.goals)
    .where(eq(tables.goals.status, "parked"))
    .orderBy(desc(tables.goals.parkedAt));

  const [doneRow] = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(tables.goals)
    .where(eq(tables.goals.status, "done"));
  const doneCount = doneRow?.count ?? 0;

  const monthOf = (date: Date | null) =>
    date
      ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, month: "long" }).format(date)
      : null;

  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Goals</h1>
      </header>

      <EnergyCheckIn current={energy} />

      <ShowupBar days={days.map((day) => ({ day, shownUp: shownDays.has(day) }))} />

      <SectionTitle>Sparks</SectionTitle>
      <SparkInbox sparks={sparks} defaultOpen={params.tab === "sparks" || sparks.length <= 3} />

      <SectionTitle>Doable right now</SectionTitle>
      {ranked.length > 0 ? (
        <div className="space-y-2">
          {ranked.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={{
                id: goal.id,
                title: goal.title,
                nextAction: goal.nextAction,
                excitement: goal.excitement,
                energyRequired: goal.energyRequired,
                estimatedMinutes: goal.estimatedMinutes,
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="✨"
          title="Nothing on the go"
          hint="Catch a spark above — three vague words is a perfectly good start."
        />
      )}

      {parked.length > 0 ? (
        <details className="group mt-6">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-(--radius-card) px-1 py-2 text-sm text-(--color-fog) [&::-webkit-details-marker]:hidden">
            <span>Parked · {parked.length}</span>
            <span aria-hidden className="group-open:hidden">
              ▸
            </span>
            <span aria-hidden className="hidden group-open:inline">
              ▾
            </span>
          </summary>

          <div className="mt-1 space-y-2">
            {parked.map((goal) => {
              const month = monthOf(goal.parkedAt);
              return (
                <Card key={goal.id}>
                  <div className="font-medium text-(--color-mist)">{goal.title}</div>
                  <p className="mt-1 text-sm text-(--color-fog)">
                    {month
                      ? `You parked this in ${month} — still interesting?`
                      : "You parked this a while back — still interesting?"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={bringBack} className="flex-1">
                      <input type="hidden" name="id" value={goal.id} />
                      <button
                        type="submit"
                        className="min-h-11 w-full rounded-xl bg-(--color-ink-soft) px-4 py-2 text-sm font-medium text-(--color-mist) transition-colors active:bg-(--color-beacon-soft) active:text-(--color-beacon)"
                      >
                        Bring it back
                      </button>
                    </form>
                    <form action={letItRest} className="flex-1">
                      <input type="hidden" name="id" value={goal.id} />
                      <button
                        type="submit"
                        className="min-h-11 w-full rounded-xl px-4 py-2 text-sm text-(--color-fog) transition-colors active:text-(--color-mist)"
                      >
                        Let it rest
                      </button>
                    </form>
                  </div>
                </Card>
              );
            })}
          </div>
        </details>
      ) : null}

      {doneCount > 0 ? (
        <p className="mt-6 px-1 text-center text-sm text-(--color-fog)">
          {doneCount} done and quietly filed away.
        </p>
      ) : null}
    </main>
  );
}
