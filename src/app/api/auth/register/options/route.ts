import { generateRegistrationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { storeChallenge } from "@/lib/auth/challenge";
import { sessionUserId } from "@/lib/auth/session";
import { rpID } from "@/lib/env";

// Registration is open only while no credential exists (first-run bootstrap),
// or from an authenticated session (adding another passkey/device).

export async function POST() {
  const existing = await db.select({ id: tables.webauthnCredentials.id }).from(tables.webauthnCredentials);
  const userId = await sessionUserId();

  if (existing.length > 0 && !userId) {
    return NextResponse.json({ error: "registration closed" }, { status: 403 });
  }

  const options = await generateRegistrationOptions({
    rpName: "Lighthouse",
    rpID: rpID(),
    userName: "you",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  await storeChallenge(options.challenge, "register");
  return NextResponse.json(options);
}
