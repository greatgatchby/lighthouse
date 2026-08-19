import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Patch = z.object({
  status: z.enum(["want", "reading", "done", "abandoned"]).optional(),
  rating: z.number().int().min(1).max(5).nullish(),
  notes: z.string().max(4000).nullish(),
});

/**
 * PATCH /api/reading/:id — move an item along its lane.
 * Status transitions own the timestamps so the UI never has to think about them.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const body: unknown = await request.json().catch(() => null);
  const parsed = Patch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid patch", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const [existing] = await db
    .select()
    .from(tables.readingItems)
    .where(eq(tables.readingItems.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch: Partial<typeof tables.readingItems.$inferInsert> = {};
  const now = new Date();

  if (input.status && input.status !== existing.status) {
    patch.status = input.status;
    if (input.status === "reading") {
      patch.startedAt = existing.startedAt ?? now;
      patch.finishedAt = null;
    } else if (input.status === "done") {
      patch.startedAt = existing.startedAt ?? now;
      patch.finishedAt = now;
    } else if (input.status === "abandoned") {
      patch.finishedAt = existing.finishedAt ?? now;
    } else {
      // back to "want" — a clean slate, no residue
      patch.startedAt = null;
      patch.finishedAt = null;
      patch.rating = null;
    }
  }

  if (input.rating !== undefined) patch.rating = input.rating;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, item: existing });

  const [item] = await db
    .update(tables.readingItems)
    .set(patch)
    .where(eq(tables.readingItems.id, id))
    .returning();

  return NextResponse.json({ ok: true, item });
}

/** DELETE /api/reading/:id */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const removed = await db
    .delete(tables.readingItems)
    .where(eq(tables.readingItems.id, id))
    .returning({ id: tables.readingItems.id });

  if (removed.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
