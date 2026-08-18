import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: recurring detection + subscription graveyard

const detectRecurring: JobDefinition = {
  queue: QUEUES.detectRecurring,
  schedule: { cron: "15 3 * * *" },
  handler: async (jobs) => {
    console.log(`[detectRecurring] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default detectRecurring;
