import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

/** "Let it go" — a spark that no longer sparks. Neutral, not a failure; the
 * text stays in the table so nothing captured is ever actually destroyed. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const [spark] = await db
    .update(tables.sparks)
    .set({ dismissedAt: new Date() })
    .where(eq(tables.sparks.id, id))
    .returning({ id: tables.sparks.id });

  if (!spark) return NextResponse.json({ error: "spark not found" }, { status: 404 });
  return NextResponse.json({ ok: true, id: spark.id });
}
