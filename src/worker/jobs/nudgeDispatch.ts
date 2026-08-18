import { QUEUES } from "@/lib/queues";
import { dispatchDueNudges } from "@/lib/push";
import type { JobDefinition } from "../types";

// Every minute: deliver due nudges (scheduled reminders + notifications that
// were parked during quiet hours).

const nudgeDispatch: JobDefinition = {
  queue: QUEUES.nudgeDispatch,
  schedule: { cron: "* * * * *" },
  workOptions: { pollingIntervalSeconds: 30 },
  handler: async () => {
    const delivered = await dispatchDueNudges();
    if (delivered > 0) console.log(`[nudge-dispatch] delivered ${delivered}`);
  },
};

export default nudgeDispatch;
