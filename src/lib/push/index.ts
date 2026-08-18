import webpush from "web-push";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import type { NotificationCategory } from "@/db/schema/core";

// Push payloads are fully self-contained: the service worker renders them with
// zero network access, which is what makes push work when the phone is off the
// tailnet. Keep them small (<2KB is safe under APNs web push limits).

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path to open on tap, e.g. "/money" */
  url?: string;
  /** Collapse key — replaces an earlier notification with the same tag */
  tag?: string;
  category: NotificationCategory;
  actions?: { action: string; title: string }[];
  data?: Record<string, unknown>;
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) {
    throw new Error("VAPID keys not set — run `pnpm vapid` and fill .env");
  }
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
}

async function loadSettings() {
  const [row] = await db.select().from(tables.settings).limit(1);
  return row ?? null;
}

function minutesNowIn(timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function inQuietHours(start: number, end: number, nowMinutes: number): boolean {
  if (start === end) return false;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end; // wraps midnight
}

/** Next Date at which quiet hours end, in the given timezone. */
export function quietHoursEndDate(end: number, timezone: string): Date {
  const now = new Date();
  const nowMinutes = minutesNowIn(timezone);
  let deltaMinutes = end - nowMinutes;
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;
  return new Date(now.getTime() + deltaMinutes * 60_000);
}

export type PushResult =
  | { sent: number; failed: number }
  | { deferredUntil: Date }
  | { skipped: "muted" | "no-subscriptions" };

/**
 * Send a push to every registered device, honouring per-category toggles and
 * quiet hours. During quiet hours the notification is parked in `nudges` and
 * delivered by the nudge-dispatch job when quiet hours end.
 */
export async function sendPush(
  payload: PushPayload,
  opts: { ignoreQuietHours?: boolean } = {},
): Promise<PushResult> {
  const settings = await loadSettings();
  if (settings) {
    const toggles = settings.notificationToggles;
    if (toggles && toggles[payload.category] === false) return { skipped: "muted" };
    if (!opts.ignoreQuietHours) {
      const now = minutesNowIn(settings.timezone);
      if (inQuietHours(settings.quietHoursStart, settings.quietHoursEnd, now)) {
        const deferredUntil = quietHoursEndDate(settings.quietHoursEnd, settings.timezone);
        await db.insert(tables.nudges).values({
          message: `${payload.title} — ${payload.body}`,
          category: payload.category,
          url: payload.url,
          scheduledFor: deferredUntil,
          meta: { deferredPayload: payload as unknown as Record<string, unknown> },
        });
        return { deferredUntil };
      }
    }
  }
  return deliverToAll(payload);
}

/** Deliver immediately, no toggle/quiet-hour checks (used by nudge-dispatch + test push). */
export async function deliverToAll(payload: PushPayload): Promise<PushResult> {
  ensureConfigured();
  const subs = await db.select().from(tables.pushSubscriptions);
  if (subs.length === 0) return { skipped: "no-subscriptions" };

  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 24 * 60 * 60, urgency: "high" },
      );
      sent += 1;
      await db
        .update(tables.pushSubscriptions)
        .set({ lastSuccessAt: new Date(), failCount: 0 })
        .where(eq(tables.pushSubscriptions.id, sub.id));
    } catch (err) {
      failed += 1;
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // subscription is gone — remove it
        await db.delete(tables.pushSubscriptions).where(eq(tables.pushSubscriptions.id, sub.id));
      } else {
        await db
          .update(tables.pushSubscriptions)
          .set({ failCount: dsql`${tables.pushSubscriptions.failCount} + 1` })
          .where(eq(tables.pushSubscriptions.id, sub.id));
      }
    }
  }
  return { sent, failed };
}

/** Due parked nudges (quiet-hours deferrals + scheduled reminders). */
export async function dispatchDueNudges(): Promise<number> {
  const due = await db
    .select()
    .from(tables.nudges)
    .where(and(isNull(tables.nudges.sentAt), dsql`${tables.nudges.scheduledFor} <= now()`));

  let delivered = 0;
  for (const nudge of due) {
    const deferred = nudge.meta?.deferredPayload as PushPayload | undefined;

    // A quiet-hours deferral was already checked against toggles and is
    // scheduled for the moment quiet hours end — deliver it directly.
    // A freshly scheduled reminder (from chat or a job) has not been checked,
    // so it goes through sendPush, which may mute it or re-park it until
    // morning. Reminders must never be the thing that wakes you at 2am.
    const result = deferred
      ? await deliverToAll(deferred)
      : await sendPush({
          title: "Lighthouse",
          body: nudge.message,
          url: nudge.url ?? "/",
          category: (nudge.category as NotificationCategory) ?? "system",
        });

    await db
      .update(tables.nudges)
      .set({ sentAt: new Date() })
      .where(eq(tables.nudges.id, nudge.id));
    if ("sent" in result) delivered += result.sent;
  }
  return delivered;
}
