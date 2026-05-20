/**
 * DESTRUCTIVE: drops the `public` schema and recreates it empty.
 * Use only on a dev DB you don't mind nuking. Requires DB_RESET_CONFIRM=yes
 * to actually run, so it can't be triggered accidentally.
 *
 * Run with:  DB_RESET_CONFIRM=yes npm run db:reset
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";

async function main(): Promise<void> {
  if (process.env["DB_RESET_CONFIRM"] !== "yes") {
    // eslint-disable-next-line no-console
    console.error(
      "Refusing to reset. Re-run with DB_RESET_CONFIRM=yes if you really want to drop the public schema.",
    );
    process.exit(1);
  }

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  // Refuse anything that smells like production.
  if (/prod|production/i.test(url)) {
    throw new Error(
      "DATABASE_URL contains 'prod' / 'production'. Refusing to reset.",
    );
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    // eslint-disable-next-line no-console
    console.log("Dropping schema 'public' and 'drizzle' (if present)…");
    await pool.query(`DROP SCHEMA IF EXISTS public CASCADE;`);
    await pool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE;`);
    await pool.query(`CREATE SCHEMA public;`);
    await pool.query(`GRANT ALL ON SCHEMA public TO postgres;`);
    await pool.query(`GRANT ALL ON SCHEMA public TO public;`);
    // eslint-disable-next-line no-console
    console.log("Schema reset complete. Run `npm run db:setup` next.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
