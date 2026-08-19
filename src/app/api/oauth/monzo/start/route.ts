import { NextResponse } from "next/server";
import { sessionUserId, secureCookies } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { MONZO_STATE_COOKIE, createOauthState, monzoAuthUrl } from "@/lib/providers/monzo";

// Step one of the Monzo dance: mint a signed CSRF state, park it in a
// short-lived httpOnly cookie, and hand the browser to auth.monzo.com.
// This is a navigation (a <Link> in Settings), so every failure ends up as a
// redirect back into the app rather than JSON no one will ever see.

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", env.appUrl));

  if (!env.monzoClientId || !env.monzoClientSecret) {
    return NextResponse.redirect(new URL("/settings?monzo=unconfigured", env.appUrl));
  }

  const { state, token } = await createOauthState();
  const response = NextResponse.redirect(monzoAuthUrl(state));
  response.cookies.set(MONZO_STATE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
