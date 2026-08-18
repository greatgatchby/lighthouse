import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: weekly fresh angle on a stale-but-wanted goal

const novelty: JobDefinition = {
  queue: QUEUES.novelty,
  schedule: { cron: "0 10 * * 1" },
  handler: async (jobs) => {
    console.log(`[novelty] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default novelty;
