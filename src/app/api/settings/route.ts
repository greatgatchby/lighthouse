import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

export async function GET() {
  await requireUserId();
  const [row] = await db.select().from(tables.settings).limit(1);
  return NextResponse.json(row ?? null);
}

export async function PATCH(request: Request) {
  const userId = await requireUserId();
  const body = await request.json();

  const patch: Partial<typeof tables.settings.$inferInsert> = {};
  if (typeof body.quietHoursStart === "number") patch.quietHoursStart = body.quietHoursStart;
  if (typeof body.quietHoursEnd === "number") patch.quietHoursEnd = body.quietHoursEnd;
  if (body.notificationToggles && typeof body.notificationToggles === "object") {
    patch.notificationToggles = body.notificationToggles;
  }
  if (typeof body.paydayDayOfMonth === "number" || body.paydayDayOfMonth === null) {
    patch.paydayDayOfMonth = body.paydayDayOfMonth;
  }
  if (typeof body.timezone === "string") patch.timezone = body.timezone;
  if (body.profile && typeof body.profile === "object") patch.profile = body.profile;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updatedAt = new Date();

  await db.update(tables.settings).set(patch).where(eq(tables.settings.userId, userId));
  const [row] = await db.select().from(tables.settings).limit(1);
  return NextResponse.json(row);
}
