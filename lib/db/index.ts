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

// Pool sizing — keep VERY low in production. Each warm Vercel lambda
// owns its own pool; with `max: N` and M lambdas you can hold up to
// N*M upstream connections. Even with Neon's pgbouncer in front, a
// high `max` exhausts pooler slots under concurrency (notification
// polling × users adds up fast). With `max: 1` each lambda holds at
// most one connection; a Promise.all of N queries serialises through
// it — a few ms of overhead, not a functional issue.
// Pair this with the POOLED Neon URL (host has '-pooler') on Vercel.
const POOL_MAX = process.env["NODE_ENV"] === "production" ? 1 : 5;

const pool: Pool =
  globalRef.__vauditPgPool ??
  new Pool({
    connectionString,
    max: POOL_MAX,
    // Drop idle connections aggressively so a warm lambda doesn't
    // squat on a pooler slot while sitting on a quiet page.
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
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
