import { desc, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { groupByLocalDay } from "@/components/trackers/days";

export const dynamic = "force-dynamic";

async function appTimezone(): Promise<string> {
  const [row] = await db
    .select({ timezone: tables.settings.timezone })
    .from(tables.settings)
    .limit(1);
  return row?.timezone ?? "Europe/London";
}

/** GET /api/move?days=7 — sessions grouped by local day, oldest → newest. */
export async function GET(request: Request) {
  await requireUserId();
  const raw = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), 90) : 7;
  const timezone = await appTimezone();

  const since = new Date(Date.now() - (days + 1) * 86_400_000);
  const rows = await db
    .select()
    .from(tables.workouts)
    .where(gte(tables.workouts.at, since))
    .orderBy(desc(tables.workouts.at));

  const grouped = groupByLocalDay(rows, days, timezone);
  return NextResponse.json({
    timezone,
    days: grouped.map(({ day, rows: sessions }) => ({
      day,
      count: sessions.length,
      minutes: sessions.reduce((total, s) => total + (s.minutes ?? 0), 0),
      sessions,
    })),
  });
}

const WorkoutInput = z.object({
  kind: z.string().min(1).max(60),
  minutes: z.number().int().min(1).max(1440).nullish(),
  intensity: z.enum(["easy", "moderate", "hard"]).nullish(),
  note: z.string().max(2000).nullish(),
  at: z.string().min(1).nullish(),
});

/** POST /api/move — log a movement session. Showing up is the whole metric. */
export async function POST(request: Request) {
  await requireUserId();
  const body: unknown = await request.json().catch(() => null);
  const parsed = WorkoutInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid session", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const kind = input.kind.trim().toLowerCase();
  if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 });

  const at = input.at ? new Date(input.at) : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "invalid at" }, { status: 400 });
  }

  const [workout] = await db
    .insert(tables.workouts)
    .values({
      kind,
      minutes: input.minutes ?? null,
      intensity: input.intensity ?? null,
      note: input.note?.trim() || null,
      at,
      source: "manual",
    })
    .returning();

  return NextResponse.json({ ok: true, workout }, { status: 201 });
}
