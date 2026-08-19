// Every pg-boss queue in the system. Worker registers a handler for each;
// app-side code enqueues via lib/boss.ts. Keep names stable — they're rows in
// pg-boss's tables, not just code.

export const QUEUES = {
  // finance
  monzoBackfill: "monzo-backfill",
  monzoPoll: "monzo-poll",
  lunchflowSync: "lunchflow-sync",
  tokenWatch: "token-watch",
  categorise: "categorise",
  detectRecurring: "detect-recurring",
  paydayDetect: "payday-detect",
  impulseCheck: "impulse-check",
  // documents
  docIngest: "doc-ingest",
  expiryCheck: "expiry-check",
  // claude / nudges
  digest: "digest",
  nudgeDispatch: "nudge-dispatch",
  novelty: "novelty",
  // ops
  backup: "backup",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);

/**
 * Per-queue policy. pg-boss expires a job after `expireInSeconds` in the
 * active state, so anything that legitimately runs long needs headroom or it
 * gets killed and retried mid-flight.
 */
export const QUEUE_OPTIONS: Partial<
  Record<QueueName, { policy?: "standard" | "singleton"; expireInSeconds?: number; retryLimit?: number }>
> = {
  // Waits up to 6 minutes for in-app SCA approval, then pages the entire
  // history. This is the one job that cannot be re-run to recover — Monzo
  // only serves full history once — so give it plenty of room.
  [QUEUES.monzoBackfill]: { expireInSeconds: 1800, retryLimit: 2 },
  // Polls the Batches API for up to ~11 minutes, then re-enqueues itself.
  [QUEUES.categorise]: { expireInSeconds: 1200 },
  // Every 3 minutes; overlapping runs would double-ingest, so only one may be
  // active at a time.
  [QUEUES.monzoPoll]: { policy: "singleton" },
  [QUEUES.lunchflowSync]: { policy: "singleton", expireInSeconds: 1800 },
  // Claude vision over a large PDF is not fast.
  [QUEUES.docIngest]: { expireInSeconds: 900, retryLimit: 2 },
  // pg_dump of the whole database plus a storage sync.
  [QUEUES.backup]: { expireInSeconds: 1800 },
};
