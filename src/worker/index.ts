import { PgBoss, type Job } from "pg-boss";
import { adoptBoss } from "@/lib/boss";
import { env } from "@/lib/env";
import { ALL_QUEUES, QUEUE_OPTIONS } from "@/lib/queues";
import { jobs } from "./jobs";

// The Lighthouse worker: one pg-boss instance, every scheduled/queued job.
// Same Docker image as the app, `node worker.js`.

async function main() {
  const boss = new PgBoss({ connectionString: env.databaseUrl });
  boss.on("error", (err: Error) => console.error("[pg-boss]", err));

  await boss.start();

  // Jobs that enqueue follow-up work import enqueue() from @/lib/boss; hand it
  // this instance so the worker doesn't open a second connection pool.
  adoptBoss(boss);

  for (const queue of ALL_QUEUES) {
    // createQueue is an upsert, so policy changes here apply on restart
    await boss.createQueue(queue, QUEUE_OPTIONS[queue] ?? {});
  }

  for (const job of jobs) {
    if (job.schedule) {
      await boss.schedule(job.queue, job.schedule.cron, job.schedule.data ?? {}, {
        tz: env.timezone,
      });
    }
    await boss.work(job.queue, job.workOptions ?? {}, async (batch: Job<object>[]) => {
      const started = Date.now();
      try {
        await job.handler(batch as never);
        console.log(`[${job.queue}] ok (${batch.length} job(s), ${Date.now() - started}ms)`);
      } catch (err) {
        console.error(`[${job.queue}] failed:`, err);
        throw err; // let pg-boss retry per queue policy
      }
    });
    console.log(
      `registered ${job.queue}${job.schedule ? ` (cron: ${job.schedule.cron} ${env.timezone})` : ""}`,
    );
  }

  console.log(`lighthouse worker up — ${jobs.length} queues`);

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, stopping…`);
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("worker crashed on boot:", err);
  process.exit(1);
});
