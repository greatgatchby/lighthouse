import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// A direct, human-initiated move into a pot (the payday ritual's tap).
// Claude never reaches this route — its proposals go through /api/confirm.

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  potId: z.uuid(),
  amountPence: z.number().int().positive(),
});

export async function POST(request: Request) {
  await requireUserId();

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "potId and a whole positive amountPence are required" },
      { status: 400 },
    );
  }
  const { potId, amountPence } = parsed.data;

  const [pot] = await db.select().from(tables.pots).where(eq(tables.pots.id, potId)).limit(1);
  if (!pot || pot.deleted) {
    return NextResponse.json({ error: "That pot isn’t here any more." }, { status: 404 });
  }

  const monzo = await import("@/lib/providers/monzo");

  try {
    // fresh dedupe id: this is a deliberate tap, not a retry of an older one
    await monzo.depositToPot({
      monzoPotId: pot.monzoPotId,
      amountPence,
      dedupeId: randomUUID(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(tables.auditLog).values({
      kind: "money:pot_deposit_failed",
      detail: { potId, potName: pot.name, amountPence, message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // depositToPot mirrors the pot and the source account; read them back so the
  // UI settles on real numbers rather than its optimistic guess.
  const [freshPot] = await db.select().from(tables.pots).where(eq(tables.pots.id, potId)).limit(1);
  const account = await monzo.primaryMonzoAccount();

  await db.insert(tables.auditLog).values({
    kind: "money:pot_deposit",
    detail: { potId, potName: pot.name, amountPence, source: "manual" },
  });

  return NextResponse.json({
    ok: true,
    potId,
    potBalance: freshPot?.balance ?? pot.balance + amountPence,
    accountBalance: account?.balance ?? null,
  });
}
