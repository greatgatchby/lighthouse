import { exec } from "node:child_process";
import { promisify } from "node:util";
import { db, tables } from "@/db";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

const execAsync = promisify(exec);

// Nightly pg_dump + storage sync — this is the financial and document archive.

const backup: JobDefinition = {
  queue: QUEUES.backup,
  schedule: { cron: "30 1 * * *" },
  handler: async () => {
    const { stdout, stderr } = await execAsync("sh scripts/backup.sh", {
      env: process.env,
      timeout: 10 * 60 * 1000,
    });
    await db.insert(tables.auditLog).values({
      kind: "ops:backup",
      detail: { stdout: stdout.trim().slice(-500), stderr: stderr.trim().slice(-500) },
    });
  },
};

export default backup;
