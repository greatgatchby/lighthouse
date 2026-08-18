import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: poll transactions+balance+pots

const monzoPoll: JobDefinition = {
  queue: QUEUES.monzoPoll,
  schedule: { cron: "*/3 * * * *" },
  handler: async (jobs) => {
    console.log(`[monzoPoll] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default monzoPoll;
