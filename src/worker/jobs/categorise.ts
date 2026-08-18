import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: nightly Message Batches categorisation of unknown merchants

const categorise: JobDefinition = {
  queue: QUEUES.categorise,
  schedule: { cron: "0 3 * * *" },
  handler: async (jobs) => {
    console.log(`[categorise] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default categorise;
