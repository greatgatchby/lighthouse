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

/** GET /api/food?days=7 — meals grouped by local day, oldest → newest. */
export async function GET(request: Request) {
  await requireUserId();
  const raw = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), 90) : 7;
  const timezone = await appTimezone();

  // one extra day of slack so timezone-shifted rows land in their real bucket
  const since = new Date(Date.now() - (days + 1) * 86_400_000);
  const rows = await db
    .select()
    .from(tables.meals)
    .where(gte(tables.meals.at, since))
    .orderBy(desc(tables.meals.at));

  const grouped = groupByLocalDay(rows, days, timezone);
  return NextResponse.json({
    timezone,
    days: grouped.map(({ day, rows: meals }) => ({ day, count: meals.length, meals })),
  });
}

const MealInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  calories: z.number().int().min(0).max(20000).nullish(),
  proteinG: z.number().int().min(0).max(2000).nullish(),
  carbsG: z.number().int().min(0).max(2000).nullish(),
  fatG: z.number().int().min(0).max(2000).nullish(),
  at: z.string().min(1).nullish(),
});

/** POST /api/food — log a meal. Everything but the name is optional on purpose. */
export async function POST(request: Request) {
  await requireUserId();
  const body: unknown = await request.json().catch(() => null);
  const parsed = MealInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid meal", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const name = input.name.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const at = input.at ? new Date(input.at) : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "invalid at" }, { status: 400 });
  }

  const description = input.description?.trim() || null;
  const [meal] = await db
    .insert(tables.meals)
    .values({
      name,
      description,
      calories: input.calories ?? null,
      proteinG: input.proteinG ?? null,
      carbsG: input.carbsG ?? null,
      fatG: input.fatG ?? null,
      at,
      source: "manual",
    })
    .returning();

  return NextResponse.json({ ok: true, meal }, { status: 201 });
}
