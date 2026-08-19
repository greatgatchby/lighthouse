import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { storeChallenge } from "@/lib/auth/challenge";
import { rpID } from "@/lib/env";

export async function POST() {
  // Discoverable credentials: no allowCredentials — one Face ID tap, no username
  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    // Matches requireUserVerification: true on the verify side (see
    // register/options for why "preferred" breaks).
    userVerification: "required",
  });
  await storeChallenge(options.challenge, "login");
  return NextResponse.json(options);
}
