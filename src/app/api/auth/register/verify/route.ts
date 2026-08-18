import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { consumeChallenge } from "@/lib/auth/challenge";
import { establishSession, sessionUserId } from "@/lib/auth/session";
import { expectedOrigin, rpID } from "@/lib/env";

export async function POST(request: Request) {
  const body = await request.json();
  const challenge = await consumeChallenge("register");
  if (!challenge) {
    return NextResponse.json({ error: "challenge expired" }, { status: 400 });
  }

  const existing = await db
    .select({ id: tables.webauthnCredentials.id })
    .from(tables.webauthnCredentials);
  const currentUserId = await sessionUserId();
  if (existing.length > 0 && !currentUserId) {
    return NextResponse.json({ error: "registration closed" }, { status: 403 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpID(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const userId =
    currentUserId ??
    (await (async () => {
      const [user] = await db.insert(tables.users).values({}).returning({ id: tables.users.id });
      await db.insert(tables.settings).values({ userId: user.id }).onConflictDoNothing();
      return user.id;
    })());

  await db.insert(tables.webauthnCredentials).values({
    id: credential.id,
    userId,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  });

  await establishSession(userId);
  return NextResponse.json({ ok: true });
}
