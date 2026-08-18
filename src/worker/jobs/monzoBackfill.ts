import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: critical one-shot full-history backfill, enqueued by the OAuth callback

const monzoBackfill: JobDefinition = {
  queue: QUEUES.monzoBackfill,
  handler: async (jobs) => {
    console.log(`[monzoBackfill] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default monzoBackfill;
