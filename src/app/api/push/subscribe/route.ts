import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { env } from "@/lib/env";

/** The browser needs the VAPID public key to subscribe. */
export async function GET() {
  return NextResponse.json({ vapidPublicKey: env.vapidPublicKey });
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  const sub = await request.json();
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  await db
    .insert(tables.pushSubscriptions)
    .values({
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: request.headers.get("user-agent") ?? undefined,
    })
    .onConflictDoUpdate({
      target: tables.pushSubscriptions.endpoint,
      set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, failCount: 0 },
    });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  await requireUserId();
  const { endpoint } = await request.json();
  if (endpoint) {
    await db.delete(tables.pushSubscriptions).where(eq(tables.pushSubscriptions.endpoint, endpoint));
  }
  return NextResponse.json({ ok: true });
}
