import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: salary credit detection -> payday ritual push

const paydayDetect: JobDefinition = {
  queue: QUEUES.paydayDetect,
  schedule: { cron: "0 * * * *" },
  handler: async (jobs) => {
    console.log(`[paydayDetect] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default paydayDetect;
