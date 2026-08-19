import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { GoalDetail } from "./GoalDetail";
import { Card, SectionTitle } from "@/components/ui";
import { formatRelativeDay } from "@/lib/format";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [goal] = await db.select().from(tables.goals).where(eq(tables.goals.id, id)).limit(1);
  if (!goal) notFound();

  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const timezone = settingsRow?.timezone ?? "Europe/London";

  const sessions = await db
    .select()
    .from(tables.goalSessions)
    .where(eq(tables.goalSessions.goalId, goal.id))
    .orderBy(desc(tables.goalSessions.startedAt))
    .limit(30);

  // A session left running (phone locked, page closed) resumes rather than
  // being lost — the clock belongs to the session, not to this tab.
  const open = sessions.find((session) => session.endedAt === null) ?? null;

  const totalMinutes = sessions.reduce((sum, session) => sum + (session.minutes ?? 0), 0);
  const logged = sessions.filter((session) => session.minutes !== null).length;
  const noveltyAngle =
    typeof goal.meta?.noveltyAngle === "string" ? (goal.meta.noveltyAngle as string) : null;

  const timeOf = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);

  return (
    <main>
      <header className="pt-6 pb-2">
        <Link href="/goals" className="text-sm text-(--color-fog)">
          ← Goals
        </Link>
      </header>

      {noveltyAngle ? (
        <Card className="mb-4">
          <div className="text-xs uppercase tracking-wider text-(--color-beacon)">
            A fresh angle 💡
          </div>
          <p className="mt-1 text-base leading-relaxed text-(--color-mist)">{noveltyAngle}</p>
        </Card>
      ) : null}

      <GoalDetail
        goal={{
          id: goal.id,
          title: goal.title,
          why: goal.why,
          area: goal.area,
          excitement: goal.excitement,
          nextAction: goal.nextAction,
          estimatedMinutes: goal.estimatedMinutes,
          energyRequired: goal.energyRequired,
          status: goal.status,
        }}
        openSession={open ? { id: open.id, startedAt: open.startedAt.toISOString() } : null}
      >
        <SectionTitle>Times you showed up</SectionTitle>
        {sessions.length > 0 ? (
          <Card className="divide-y divide-(--color-card-edge)">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span className="text-sm text-(--color-mist)">
                  {formatRelativeDay(session.startedAt, timezone)} · {timeOf(session.startedAt)}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-(--color-fog)">
                  {session.minutes !== null ? `${session.minutes} min` : "running"}
                </span>
              </div>
            ))}
            {logged > 0 ? (
              <div className="pt-2 text-center text-xs text-(--color-fog)">
                {logged} session{logged === 1 ? "" : "s"} · {totalMinutes} minutes here so far.
              </div>
            ) : null}
          </Card>
        ) : (
          <Card>
            <p className="text-sm leading-relaxed text-(--color-fog)">
              No sessions yet. The first one only has to be 25 minutes long, and it doesn’t have to
              go well.
            </p>
          </Card>
        )}
      </GoalDetail>
    </main>
  );
}
