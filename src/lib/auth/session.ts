import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "lh_session";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

/** Safari refuses Secure cookies over http://localhost, so mirror the scheme.
 * Any real deployment is HTTPS (tailscale serve), where this stays true. */
export function secureCookies(): boolean {
  return env.appUrl.startsWith("https://");
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Set the session cookie on the current response (route handlers / server actions). */
export async function establishSession(userId: string): Promise<void> {
  const token = await createSessionToken(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Current user id, or null. For route handlers and server components. */
export async function sessionUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Throwing variant for API routes that the proxy should already have gated. */
export async function requireUserId(): Promise<string> {
  const userId = await sessionUserId();
  if (!userId) throw new Error("Unauthenticated");
  return userId;
}
