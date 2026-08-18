import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

// Lazy singleton: nothing touches DATABASE_URL until the first query, so
// `next build` (which imports route modules with no runtime env) stays happy.

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __lighthouseSql?: ReturnType<typeof postgres>;
  __lighthouseDb?: Db;
};

function getDb(): Db {
  if (!globalForDb.__lighthouseDb) {
    globalForDb.__lighthouseSql = postgres(env.databaseUrl, {
      max: 10,
      onnotice: () => {},
    });
    globalForDb.__lighthouseDb = drizzle(globalForDb.__lighthouseSql, { schema });
  }
  return globalForDb.__lighthouseDb;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

/** Raw postgres.js client (lazy) — for LISTEN/NOTIFY or COPY needs. */
export function rawSql() {
  getDb();
  return globalForDb.__lighthouseSql!;
}

export * as tables from "./schema";
