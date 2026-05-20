/**
 * Playwright globalSetup — runs once before any test file.
 *
 * Steps:
 *   1. Validate DATABASE_URL points at a test database (must contain
 *      `_test` or be the explicit `DATABASE_URL_TEST` override) — guard
 *      against accidentally pointing at prod/dev data.
 *   2. Apply Drizzle migrations.
 *   3. Truncate user data tables then re-seed.
 *
 * Backed by `resetAndSeedDb` in tests/e2e/helpers/db.ts so individual tests
 * can call it too when they need a clean slate mid-suite.
 */
import "dotenv/config";
import { resetAndSeedDb } from "./helpers/db";

async function globalSetup(): Promise<void> {
  const url =
    process.env["DATABASE_URL_TEST"] ?? process.env["DATABASE_URL"] ?? "";
  if (!url) {
    throw new Error(
      "globalSetup: neither DATABASE_URL_TEST nor DATABASE_URL is set",
    );
  }
  // Safety: refuse to run against a non-test DB unless explicitly opted in.
  const explicitlyAllowed =
    process.env["ALLOW_NON_TEST_DB"] === "1" ||
    !!process.env["DATABASE_URL_TEST"];
  if (!explicitlyAllowed && !/_test(\b|[?/_])/i.test(url)) {
    throw new Error(
      "globalSetup: DATABASE_URL does not look like a test DB " +
        "(must contain `_test`). Set DATABASE_URL_TEST or ALLOW_NON_TEST_DB=1.",
    );
  }
  // Make the chosen URL visible to the rest of the app code.
  process.env["DATABASE_URL"] = url;
  process.env["PLAYWRIGHT_TEST"] = "1";

  await resetAndSeedDb();
}

export default globalSetup;
