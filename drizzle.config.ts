import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load both .env and .env.local (the latter wins) so drizzle-kit picks up
// local overrides without callers having to remember --env flags.
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run drizzle-kit");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
