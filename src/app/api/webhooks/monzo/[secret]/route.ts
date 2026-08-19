import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { enqueue } from "@/lib/boss";
import { env } from "@/lib/env";
import { QUEUES } from "@/lib/queues";

// Monzo's transaction webhook. No session (the proxy exempts /api/webhooks/),
// so the secret in the path is the only credential — compared in constant time,
// and a mismatch is a 404 so the URL space stays unguessable.
//
// The body is UNTRUSTED and is never parsed into data: anyone who learns the
// URL could post anything. All it does is nudge the poller, which then reads
// the real transactions from Monzo's API over an authenticated connection.

export const dynamic = "force-dynamic";

function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(_request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const expected = env.monzoWebhookSecret;

  if (!expected || !matches(secret, expected)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // singletonKey collapses a burst of webhooks into one pending poll
  try {
    await enqueue(QUEUES.monzoPoll, {}, { singletonKey: "webhook" });
  } catch (err) {
    console.error("[monzo webhook] enqueue failed:", err);
  }

  return NextResponse.json({ ok: true });
}
