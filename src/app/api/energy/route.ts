import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

/** One-tap energy check-in — reorders the whole dashboard. */
export async function POST(request: Request) {
  const userId = await requireUserId();
  const { energy } = await request.json();
  if (!["low", "medium", "high"].includes(energy)) {
    return NextResponse.json({ error: "invalid energy" }, { status: 400 });
  }
  await db
    .update(tables.settings)
    .set({ energy, energyUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(tables.settings.userId, userId));
  return NextResponse.json({ ok: true, energy });
}
