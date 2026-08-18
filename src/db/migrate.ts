import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Standalone migration entrypoint: run by the `migrate` compose service before
// app/worker start, and by `pnpm db:migrate` in dev. Advisory lock guards
// against concurrent runs.

const MIGRATION_LOCK_KEY = 0x11674053;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("migrations applied");
  } finally {
    await client`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
