import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: extract+file an uploaded document via Claude vision

const docIngest: JobDefinition = {
  queue: QUEUES.docIngest,
  handler: async (jobs) => {
    console.log(`[docIngest] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default docIngest;
