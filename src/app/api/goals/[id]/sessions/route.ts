import { NextResponse } from "next/server";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { localDay } from "@/lib/format";

// Body-doubling sessions. Starting one is the whole game: it counts as showing
// up for today (forgiving streak), refreshes the goal's excitement clock, and
// marks the goal touched. Stopping just records how long you were in it —
// there is no minimum, and no session is ever "too short".

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("stop"),
    sessionId: z.uuid(),
    note: z.string().trim().max(1000).nullish(),
  }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid session action" }, { status: 400 });
  }
  const body = parsed.data;
  const now = new Date();

  const [goal] = await db
    .select({ id: tables.goals.id })
    .from(tables.goals)
    .where(eq(tables.goals.id, id))
    .limit(1);
  if (!goal) return NextResponse.json({ error: "goal not found" }, { status: 404 });

  if (body.action === "start") {
    const [session] = await db
      .insert(tables.goalSessions)
      .values({ goalId: id, startedAt: now })
      .returning();

    const [settingsRow] = await db.select().from(tables.settings).limit(1);
    const day = localDay(now, settingsRow?.timezone ?? "Europe/London");

    // you showed up today — that's the only thing the streak ever measures
    await db
      .insert(tables.showups)
      .values({ day, count: 1 })
      .onConflictDoUpdate({
        target: tables.showups.day,
        set: { count: dsql`${tables.showups.count} + 1` },
      });

    await db
      .update(tables.goals)
      .set({ lastTouchedAt: now, excitementUpdatedAt: now, updatedAt: now })
      .where(eq(tables.goals.id, id));

    return NextResponse.json({ id: session.id, session, day }, { status: 201 });
  }

  const [open] = await db
    .select()
    .from(tables.goalSessions)
    .where(
      and(
        eq(tables.goalSessions.id, body.sessionId),
        eq(tables.goalSessions.goalId, id),
        isNull(tables.goalSessions.endedAt),
      ),
    )
    .limit(1);
  if (!open) return NextResponse.json({ error: "no session running" }, { status: 404 });

  const minutes = Math.max(1, Math.round((now.getTime() - open.startedAt.getTime()) / 60_000));

  const [session] = await db
    .update(tables.goalSessions)
    .set({ endedAt: now, minutes, note: body.note ?? null })
    .where(eq(tables.goalSessions.id, open.id))
    .returning();

  await db
    .update(tables.goals)
    .set({ lastTouchedAt: now, updatedAt: now })
    .where(eq(tables.goals.id, id));

  return NextResponse.json({ id: session.id, session, minutes });
}
