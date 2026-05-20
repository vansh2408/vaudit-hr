/**
 * Drizzle PostgreSQL client (node-postgres pool).
 *
 * One pool per process. Re-uses across HMR in dev via globalThis.
 */
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

type GlobalWithPool = typeof globalThis & {
  __vauditPgPool?: Pool;
  __vauditDb?: NodePgDatabase<typeof schema>;
};

const globalRef = globalThis as GlobalWithPool;

const pool: Pool =
  globalRef.__vauditPgPool ??
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env["NODE_ENV"] !== "production") {
  globalRef.__vauditPgPool = pool;
}

export const db: NodePgDatabase<typeof schema> =
  globalRef.__vauditDb ?? drizzle(pool, { schema });

if (process.env["NODE_ENV"] !== "production") {
  globalRef.__vauditDb = db;
}

export { pool, schema };
