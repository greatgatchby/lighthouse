import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { sessionUserId } from "@/lib/auth/session";
import { enqueue } from "@/lib/boss";
import { env } from "@/lib/env";
import { MONZO_STATE_COOKIE, exchangeCode, verifyOauthState } from "@/lib/providers/monzo";
import { QUEUES } from "@/lib/queues";

// Step two. The five-minute window is the whole story here: Monzo only serves
// full transaction history for ~5 minutes after authorisation, so the backfill
// is enqueued *synchronously* before we redirect. Never make this lazy.

export const dynamic = "force-dynamic";

function back(path: string) {
  return NextResponse.redirect(new URL(path, env.appUrl));
}

export async function GET(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return back("/login");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const store = await cookies();
  const stateToken = store.get(MONZO_STATE_COOKIE)?.value;

  const clear = (response: NextResponse) => {
    response.cookies.delete(MONZO_STATE_COOKIE);
    return response;
  };

  if (error) return clear(back("/settings?monzo=declined"));
  if (!code || !(await verifyOauthState(stateToken, state))) {
    return clear(back("/settings?monzo=state"));
  }

  try {
    await exchangeCode(code);
  } catch (err) {
    console.error("[monzo] code exchange failed:", err);
    await db.insert(tables.auditLog).values({
      kind: "monzo:oauth_error",
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    return clear(back("/settings?monzo=failed"));
  }

  // Synchronous, before the redirect — the history window is already ticking.
  try {
    await enqueue(QUEUES.monzoBackfill, {}, { priority: 10, retryLimit: 2, retryDelay: 30 });
  } catch (err) {
    console.error("[monzo] could not enqueue backfill:", err);
  }

  await db.insert(tables.auditLog).values({ kind: "monzo:connected", detail: {} });
  return clear(back("/money?connected=1"));
}
