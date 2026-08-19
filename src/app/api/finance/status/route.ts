import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { env } from "@/lib/env";

// Connection state for the money + settings screens. Never leaks tokens —
// only whether a connection exists, how it's doing, and when it lapses.

export const dynamic = "force-dynamic";

export async function GET() {
  await requireUserId();

  const [monzo] = await db
    .select()
    .from(tables.providerConnections)
    .where(eq(tables.providerConnections.provider, "monzo"))
    .limit(1);

  return NextResponse.json({
    monzo: {
      connected: Boolean(monzo?.accessTokenEnc) && monzo?.status !== "revoked",
      status: monzo?.status ?? "disconnected",
      expiresAt: monzo?.expiresAt ? monzo.expiresAt.toISOString() : null,
    },
    lunchflow: {
      connected: Boolean(env.lunchflowApiKey),
    },
  });
}
