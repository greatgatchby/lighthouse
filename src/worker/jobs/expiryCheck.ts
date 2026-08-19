import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, tables } from "@/db";
import { localDay } from "@/lib/format";
import { sendPush } from "@/lib/push";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// 08:00 daily: a heads-up at 90, 30, 7 and 1 days. Four taps on the shoulder,
// spread out enough that none of them feels like nagging — and never a red
// banner in the app, just an amber pill on the card.

const OFFSETS = [90, 30, 7, 1];

const expiryCheck: JobDefinition = {
  queue: QUEUES.expiryCheck,
  schedule: { cron: "0 8 * * *" },
  handler: async () => {
    const [settingsRow] = await db.select().from(tables.settings).limit(1);
    const timezone = settingsRow?.timezone ?? "Europe/London";

    // exact-day matching: each document gets one nudge per milestone, not a
    // daily drip once it's inside the window
    const daysByDate = new Map<string, number>();
    for (const offset of OFFSETS) {
      daysByDate.set(localDay(new Date(Date.now() + offset * 86_400_000), timezone), offset);
    }

    const due = await db
      .select({
        id: tables.documents.id,
        title: tables.documents.title,
        filename: tables.documents.filename,
        expiresAt: tables.documents.expiresAt,
      })
      .from(tables.documents)
      .where(
        and(
          eq(tables.documents.status, "extracted"),
          isNotNull(tables.documents.expiresAt),
          inArray(tables.documents.expiresAt, [...daysByDate.keys()]),
        ),
      );

    for (const doc of due) {
      const days = doc.expiresAt ? daysByDate.get(doc.expiresAt) : undefined;
      if (!days) continue;
      const title = doc.title?.trim() || doc.filename;
      const when = days === 1 ? "expires tomorrow" : `expires in ${days} days`;
      await sendPush({
        title: "Coming up",
        body: `${title} ${when}`,
        url: "/documents",
        tag: `doc-expiry-${doc.id}-${days}`,
        category: "documents",
      });
    }

    if (due.length > 0) console.log(`[expiry-check] ${due.length} reminder(s)`);
  },
};

export default expiryCheck;
