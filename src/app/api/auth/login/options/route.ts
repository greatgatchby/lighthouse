import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { storeChallenge } from "@/lib/auth/challenge";
import { rpID } from "@/lib/env";

export async function POST() {
  // Discoverable credentials: no allowCredentials — one Face ID tap, no username
  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: "preferred",
  });
  await storeChallenge(options.challenge, "login");
  return NextResponse.json(options);
}
