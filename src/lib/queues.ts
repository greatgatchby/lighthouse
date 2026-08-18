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
