import { PgBoss, type SendOptions } from "pg-boss";
import { env } from "./env";
import { ALL_QUEUES, type QueueName } from "./queues";

// Shared pg-boss handle. The worker process starts it with workers attached;
// the Next.js app uses the same helper purely to enqueue (send/schedule).

const globalForBoss = globalThis as unknown as { __lighthouseBoss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.__lighthouseBoss) {
    globalForBoss.__lighthouseBoss = (async () => {
      const boss = new PgBoss({
        connectionString: env.databaseUrl,
        // the app side never polls; workers are only attached in src/worker
      });
      boss.on("error", (err: Error) => console.error("[pg-boss]", err));
      await boss.start();
      for (const queue of ALL_QUEUES) {
        // createQueue is an upsert in pg-boss v10+; safe to call on every boot
        await boss.createQueue(queue);
      }
      return boss;
    })();
  }
  return globalForBoss.__lighthouseBoss;
}

export async function enqueue(
  queue: QueueName,
  data: object = {},
  options: SendOptions = {},
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(queue, data, options);
}
