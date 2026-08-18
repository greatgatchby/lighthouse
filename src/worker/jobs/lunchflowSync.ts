import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: nightly Lunchflow sync + long-term backstop + dedupe pairing

const lunchflowSync: JobDefinition = {
  queue: QUEUES.lunchflowSync,
  schedule: { cron: "30 2 * * *" },
  handler: async (jobs) => {
    console.log(`[lunchflowSync] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default lunchflowSync;
