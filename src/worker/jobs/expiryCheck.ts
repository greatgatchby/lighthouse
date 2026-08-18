import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: expiry pushes at 90/30/7 days

const expiryCheck: JobDefinition = {
  queue: QUEUES.expiryCheck,
  schedule: { cron: "0 8 * * *" },
  handler: async (jobs) => {
    console.log(`[expiryCheck] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default expiryCheck;
