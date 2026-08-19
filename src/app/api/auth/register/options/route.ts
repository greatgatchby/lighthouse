import { generateRegistrationOptions } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { storeChallenge } from "@/lib/auth/challenge";
import { sessionUserId } from "@/lib/auth/session";
import { rpID } from "@/lib/env";

// Registration is open only while no credential exists (first-run bootstrap),
// or from an authenticated session (adding another passkey/device).

export async function POST() {
  const rp = rpID();
  // Scope the bootstrap gate to this origin: a passkey registered against
  // localhost can't authenticate on the tailnet hostname, so that origin must
  // still be allowed to enroll its first credential.
  const existing = await db
    .select({ id: tables.webauthnCredentials.id })
    .from(tables.webauthnCredentials)
    .where(eq(tables.webauthnCredentials.rpId, rp));
  const userId = await sessionUserId();

  if (existing.length > 0 && !userId) {
    return NextResponse.json({ error: "registration closed" }, { status: 403 });
  }

  const options = await generateRegistrationOptions({
    rpName: "Lighthouse",
    rpID: rp,
    userName: "you",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id })),
    authenticatorSelection: {
      // Discoverable credential: one Face ID tap, no username to type.
      residentKey: "required",
      // Must be "required", not "preferred": the verifier below defaults to
      // requireUserVerification: true, so anything less lets the browser skip
      // biometrics and then fails verification with a confusing error.
      userVerification: "required",
    },
  });

  await storeChallenge(options.challenge, "register");
  return NextResponse.json(options);
}
