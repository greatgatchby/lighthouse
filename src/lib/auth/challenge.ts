import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { secureCookies } from "./session";

// WebAuthn challenges ride in a short-lived signed cookie between the
// options call and the verify call — no server-side challenge table needed.

const CHALLENGE_COOKIE = "lh_challenge";

function secret(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function storeChallenge(challenge: string, purpose: "register" | "login") {
  const token = await new SignJWT({ challenge, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });
}

export async function consumeChallenge(purpose: "register" | "login"): Promise<string | null> {
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE)?.value;
  store.delete(CHALLENGE_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== purpose) return null;
    return typeof payload.challenge === "string" ? payload.challenge : null;
  } catch {
    return null;
  }
}
