import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { lastLocalDays } from "@/components/goals/days";

/** The forgiving streak: the last 7 local days, each either shown up or not.
 * There is no "current streak" and nothing ever resets to zero. */
export async function GET() {
  await requireUserId();

  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const days = lastLocalDays(7, settingsRow?.timezone ?? "Europe/London");

  const rows = await db
    .select()
    .from(tables.showups)
    .where(inArray(tables.showups.day, days));
  const shown = new Set(rows.map((r) => r.day));

  return NextResponse.json(days.map((day) => ({ day, shownUp: shown.has(day) })));
}
