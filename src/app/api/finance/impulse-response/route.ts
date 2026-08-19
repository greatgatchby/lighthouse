import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";

// The answer to a "happy with it?" check-in. Every answer is fine — this is a
// record of how purchases actually felt, never a verdict on them.
//   happy     → noted, nothing else happens
//   returning → noted; the intention is the whole point
//   reflect   → sit with it, and we'll ask again tomorrow

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  transactionId: z.uuid(),
  response: z.enum(["happy", "returning", "reflect"]),
});

export async function POST(request: Request) {
  await requireUserId();

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "transactionId and a response of happy, returning or reflect are required" },
      { status: 400 },
    );
  }
  const { transactionId, response } = parsed.data;

  const [row] = await db
    .select({
      id: tables.transactions.id,
      amount: tables.transactions.amount,
      description: tables.transactions.description,
      merchant: tables.merchants.displayName,
    })
    .from(tables.transactions)
    .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
    .where(eq(tables.transactions.id, transactionId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "That purchase isn’t here." }, { status: 404 });
  }

  const label = row.merchant ?? row.description ?? "that purchase";

  await db.insert(tables.auditLog).values({
    kind: "impulse:response",
    detail: {
      transactionId,
      response,
      merchant: label,
      amountPence: row.amount,
    },
  });

  if (response === "reflect") {
    await db.insert(tables.nudges).values({
      message: `Still thinking about ${label} (${formatMoney(Math.abs(row.amount))})? Either answer is a good one.`,
      category: "impulse",
      url: `/money/impulse?tx=${transactionId}`,
      scheduledFor: new Date(Date.now() + 86_400_000),
      meta: { transactionId, source: "impulse:reflect" },
    });
  }

  return NextResponse.json({ ok: true, response });
}
