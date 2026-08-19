import { and, desc, eq, gte } from "drizzle-orm";
import { db, tables } from "@/db";
import * as monzo from "@/lib/providers/monzo";
import { sendPush } from "@/lib/push";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// A silent Monzo connection is the worst failure mode this app has: the number
// on the home screen quietly goes stale and nothing says so. Once a morning,
// check the token, and if it's fading say so — but no more than every third
// day, because a nag you can't act on right now is just noise.

const WARN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REMIND_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
const PUSH_KIND = "monzo:reauth_push";

const tokenWatch: JobDefinition = {
  queue: QUEUES.tokenWatch,
  schedule: { cron: "0 9 * * *" },
  handler: async () => {
    const connection = await monzo.getConnection();
    if (!connection || !connection.accessTokenEnc) return;
    if (connection.status === "revoked") return;

    const expiresAt = connection.expiresAt?.getTime() ?? null;
    const fading =
      connection.status === "expired" ||
      connection.status === "error" ||
      (expiresAt !== null && expiresAt - Date.now() < WARN_WINDOW_MS);
    if (!fading) return;

    const [recent] = await db
      .select({ id: tables.auditLog.id })
      .from(tables.auditLog)
      .where(
        and(
          eq(tables.auditLog.kind, PUSH_KIND),
          gte(tables.auditLog.at, new Date(Date.now() - REMIND_EVERY_MS)),
        ),
      )
      .orderBy(desc(tables.auditLog.at))
      .limit(1);
    if (recent) return;

    await sendPush({
      title: "Monzo needs reconnecting",
      body: "A tap in Settings and it keeps going — takes about ten seconds.",
      url: "/settings",
      tag: "monzo-reauth",
      category: "money",
    });

    await db.insert(tables.auditLog).values({
      kind: PUSH_KIND,
      detail: {
        status: connection.status,
        expiresAt: connection.expiresAt ? connection.expiresAt.toISOString() : null,
      },
    });
  },
};

export default tokenWatch;
