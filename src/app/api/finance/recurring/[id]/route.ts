import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// "I cancelled it" / "leave it be" / "no, this is still mine".
// dismissed and cancelled are human decisions — detectRecurring never
// overwrites them, so a thing you've dealt with stays dealt with.

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  status: z.enum(["dismissed", "cancelled", "active"]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "status must be dismissed, cancelled or active" },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(tables.recurring)
    .where(eq(tables.recurring.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "That one isn’t here." }, { status: 404 });

  await db
    .update(tables.recurring)
    .set({ status: parsed.data.status })
    .where(eq(tables.recurring.id, id));

  await db.insert(tables.auditLog).values({
    kind: "finance:recurring_status",
    detail: {
      recurringId: id,
      name: row.name,
      from: row.status,
      to: parsed.data.status,
      amountPence: row.amount,
      cadence: row.cadence,
    },
  });

  return NextResponse.json({ ok: true, id, status: parsed.data.status });
}
