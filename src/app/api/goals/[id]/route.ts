import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// Editing a goal is always a "touch" — it refreshes lastTouchedAt, which is
// what the novelty job reads. Parking is neutral and fully reversible: coming
// back refreshes excitement so a revived goal isn't punished by decay.

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  why: z.string().trim().max(2000).nullish(),
  area: z.string().trim().max(80).nullish(),
  excitement: z.number().int().min(1).max(5).optional(),
  nextAction: z.string().trim().max(500).nullish(),
  estimatedMinutes: z.number().int().min(1).max(600).nullish(),
  energyRequired: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["spark", "active", "parked", "done"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const parsed = PatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid patch", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const now = new Date();

  const patch: Partial<typeof tables.goals.$inferInsert> = {
    updatedAt: now,
    lastTouchedAt: now,
  };

  if (body.title !== undefined) patch.title = body.title;
  if (body.why !== undefined) patch.why = body.why ?? null;
  if (body.area !== undefined) patch.area = body.area ?? null;
  if (body.nextAction !== undefined) patch.nextAction = body.nextAction ?? null;
  if (body.estimatedMinutes !== undefined) patch.estimatedMinutes = body.estimatedMinutes ?? null;
  if (body.energyRequired !== undefined) patch.energyRequired = body.energyRequired;

  // any excitement change is a fresh reading — restart the decay clock
  if (body.excitement !== undefined) {
    patch.excitement = body.excitement;
    patch.excitementUpdatedAt = now;
  }

  if (body.status !== undefined) {
    patch.status = body.status;
    if (body.status === "parked") {
      patch.parkedAt = now;
      patch.doneAt = null;
    } else if (body.status === "done") {
      patch.doneAt = now;
    } else {
      // back in play — clear the parking marks and give it a fresh excitement clock
      patch.parkedAt = null;
      patch.doneAt = null;
      patch.excitementUpdatedAt = now;
    }
  }

  const [goal] = await db
    .update(tables.goals)
    .set(patch)
    .where(eq(tables.goals.id, id))
    .returning();

  if (!goal) return NextResponse.json({ error: "goal not found" }, { status: 404 });
  return NextResponse.json(goal);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const [goal] = await db
    .delete(tables.goals)
    .where(eq(tables.goals.id, id))
    .returning({ id: tables.goals.id });

  if (!goal) return NextResponse.json({ error: "goal not found" }, { status: 404 });
  return NextResponse.json({ ok: true, id: goal.id });
}
