import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// STUB — replaced by its vertical: delayed per-transaction gentle impulse check-in

const impulseCheck: JobDefinition = {
  queue: QUEUES.impulseCheck,
  handler: async (jobs) => {
    console.log(`[impulseCheck] stub — not implemented yet (${jobs.length} job(s))`);
  },
};

export default impulseCheck;
