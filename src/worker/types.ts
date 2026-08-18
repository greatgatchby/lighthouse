import type { Job, WorkOptions } from "pg-boss";
import type { QueueName } from "@/lib/queues";

export interface JobDefinition<TData extends object = object> {
  queue: QueueName;
  /** Optional cron schedule (tz applied from APP_TZ at registration). */
  schedule?: { cron: string; data?: TData };
  workOptions?: WorkOptions;
  /** pg-boss v10+ hands workers a BATCH of jobs (default batch size 1). */
  handler: (jobs: Job<TData>[]) => Promise<void>;
}
