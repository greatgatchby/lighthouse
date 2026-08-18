import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { consumeChallenge } from "@/lib/auth/challenge";
import { establishSession } from "@/lib/auth/session";
import { expectedOrigin, rpID } from "@/lib/env";

export async function POST(request: Request) {
  const body = await request.json();
  const challenge = await consumeChallenge("login");
  if (!challenge) {
    return NextResponse.json({ error: "challenge expired" }, { status: 400 });
  }

  const rp = rpID();
  const [stored] = await db
    .select()
    .from(tables.webauthnCredentials)
    .where(
      and(eq(tables.webauthnCredentials.id, body.id), eq(tables.webauthnCredentials.rpId, rp)),
    )
    .limit(1);
  if (!stored) {
    return NextResponse.json({ error: "unknown credential" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rp,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: (stored.transports ?? undefined) as
          | import("@simplewebauthn/server").AuthenticatorTransportFuture[]
          | undefined,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "verification failed" }, { status: 401 });
  }

  await db
    .update(tables.webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(tables.webauthnCredentials.id, stored.id));

  await establishSession(stored.userId);
  return NextResponse.json({ ok: true });
}
