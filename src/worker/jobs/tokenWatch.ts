import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: re-auth push when Monzo token nears expiry

const tokenWatch: JobDefinition = {
  queue: QUEUES.tokenWatch,
  schedule: { cron: "0 9 * * *" },
  handler: async (jobs) => {
    console.log(`[tokenWatch] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default tokenWatch;
