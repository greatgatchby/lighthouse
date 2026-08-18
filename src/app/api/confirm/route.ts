import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// The money guardrail's second half: Claude proposes (pending_confirmations),
// a human tap lands here, and only then does anything move.

export async function POST(request: Request) {
  await requireUserId();
  const { proposalId, decision } = await request.json();
  if (!proposalId || !["confirm", "decline"].includes(decision)) {
    return NextResponse.json({ error: "proposalId and decision required" }, { status: 400 });
  }

  const [proposal] = await db
    .select()
    .from(tables.pendingConfirmations)
    .where(eq(tables.pendingConfirmations.id, proposalId))
    .limit(1);

  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `already ${proposal.status}` }, { status: 409 });
  }

  if (decision === "decline") {
    await db
      .update(tables.pendingConfirmations)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(eq(tables.pendingConfirmations.id, proposal.id));
    return NextResponse.json({ ok: true, status: "declined" });
  }

  if (proposal.kind !== "pot_deposit") {
    return NextResponse.json({ error: `unsupported kind ${proposal.kind}` }, { status: 400 });
  }

  const payload = proposal.payload as {
    monzoPotId: string;
    potName: string;
    amountPence: number;
  };

  try {
    const monzo = await import("@/lib/providers/monzo");
    await monzo.depositToPot({
      monzoPotId: payload.monzoPotId,
      amountPence: payload.amountPence,
      dedupeId: proposal.id,
    });
    await db
      .update(tables.pendingConfirmations)
      .set({ status: "executed", resolvedAt: new Date() })
      .where(eq(tables.pendingConfirmations.id, proposal.id));
    await db.insert(tables.auditLog).values({
      kind: "money:pot_deposit",
      detail: { proposalId: proposal.id, ...payload },
    });
    return NextResponse.json({ ok: true, status: "executed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(tables.pendingConfirmations)
      .set({ status: "failed", resolvedAt: new Date(), error: message })
      .where(eq(tables.pendingConfirmations.id, proposal.id));
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
