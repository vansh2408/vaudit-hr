/**
 * Apply post-init SQL (audit-log immutability triggers).
 * Idempotent — safe to re-run. Replaces `psql -f` so no local psql install needed.
 * Run with `npm run db:post-init` AFTER `npm run db:migrate`.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  const sqlPath = join(
    process.cwd(),
    "lib/db/migrations/post-init/audit-immutability.sql",
  );
  const sql = readFileSync(sqlPath, "utf8");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(sql);
    // eslint-disable-next-line no-console
    console.log("Post-init applied: audit-log immutability triggers installed.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
