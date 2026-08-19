import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE /api/move/:id */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const removed = await db
    .delete(tables.workouts)
    .where(eq(tables.workouts.id, id))
    .returning({ id: tables.workouts.id });

  if (removed.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
