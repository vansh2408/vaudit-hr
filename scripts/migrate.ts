/**
 * Apply Drizzle migrations using node-postgres.
 * Run with `npm run db:migrate`.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: "lib/db/migrations" });
    // eslint-disable-next-line no-console
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
