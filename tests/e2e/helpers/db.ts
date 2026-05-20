/**
 * DB helpers for tests.
 *
 * Two responsibilities:
 *
 * 1. `resetAndSeedDb()` — bring the test DB to a known state: apply
 *    migrations, truncate user data, run the seed script. Used by
 *    Playwright globalSetup and any unit test that wants a clean DB.
 *
 * 2. `withDbTransaction(fn)` — open a transaction, run the test body,
 *    then roll it back. Lets unit tests touch the real DB without
 *    polluting it between tests. The seeded fixture rows remain intact.
 *
 * Why a real DB instead of ORM mocks? Most bugs in this app live in the
 * SQL boundary (Drizzle queries, FK cascades, unique constraints, enum
 * coercion). Mocking Drizzle hides those. We accept the slower test by
 * running against a real Postgres and rolling back per-test.
 */
import { Pool, type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

type TestDb = NodePgDatabase<typeof schema>;

let sharedPool: Pool | null = null;

/** Returns a process-wide pool against the test DB. */
function getPool(): Pool {
  if (sharedPool) return sharedPool;
  const url =
    process.env["DATABASE_URL_TEST"] ?? process.env["DATABASE_URL"] ?? "";
  if (!url) {
    throw new Error(
      "Test DB pool: DATABASE_URL_TEST or DATABASE_URL must be set",
    );
  }
  sharedPool = new Pool({ connectionString: url, max: 4 });
  return sharedPool;
}

/** Drop the pool — useful in test teardown to let the process exit cleanly. */
export async function closeTestPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}

/**
 * Wipe all app tables (in FK-safe order) and re-run the seed script.
 * Cheap enough to call per spec file when needed; not called per test.
 */
export async function resetAndSeedDb(): Promise<void> {
  const pool = getPool();
  const db = drizzle(pool, { schema });

  // Apply migrations idempotently.
  await migrate(db, { migrationsFolder: "lib/db/migrations" });

  // TRUNCATE in dependency order. CASCADE handles FK chains.
  await db.execute(sql`
    truncate table
      audit_logs,
      notifications,
      leave_requests,
      wfh_requests,
      leave_balances,
      leave_types,
      holidays,
      sessions,
      accounts,
      verification_tokens,
      users
    restart identity cascade
  `);

  // Re-seed by spawning `tsx scripts/seed.ts`. We DON'T import the seed
  // module because it auto-runs `main()` on load — running it as a child
  // process keeps the lifecycle predictable and matches what CI does.
  const { spawnSync } = await import("node:child_process");
  const url =
    process.env["DATABASE_URL_TEST"] ?? process.env["DATABASE_URL"] ?? "";
  const result = spawnSync("npx", ["tsx", "scripts/seed.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status !== 0) {
    throw new Error(`Seed script failed with exit code ${result.status}`);
  }
}

/**
 * Run `fn` inside a Postgres transaction and ALWAYS roll back at the end,
 * even on success. Useful for unit tests that need real DB state but must
 * not leak rows between cases.
 *
 * The callback receives a Drizzle instance bound to the transaction's
 * connection — DO NOT use the global `db` from `@/lib/db` inside `fn`,
 * those queries will run on a different connection and won't see the
 * transaction's uncommitted state.
 */
export async function withDbTransaction<T>(
  fn: (tx: TestDb) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  const tx = drizzle(client, { schema });
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    return result;
  } finally {
    // Always roll back — even on success — so the next test starts clean.
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore double-rollback edge cases
    }
    client.release();
  }
}

export type { TestDb };
