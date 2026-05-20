import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — Vaudit HR E2E.
 *
 * - One worker. DB is shared across tests, so we serialize to avoid flakiness
 *   from concurrent writes against the same Postgres instance.
 * - `webServer` boots `next dev` for the tests. CI sets PLAYWRIGHT_TEST=1
 *   so /lib/auth/config.ts registers the credentials test provider.
 * - globalSetup performs migrate + seed once before any test file runs.
 * - HTML report on disk; trace recorded on first retry only (small artifacts).
 */
const isCi = !!process.env["CI"];
const baseURL = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/helpers/**", "**/global-setup.ts", "**/fixtures.ts"],
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: 1,
  reporter: isCi ? [["html", { open: "never" }], ["list"]] : "html",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Force a non-UTC, west-of-UTC timezone in the browser so calendar-date
    // round trips would surface any TZ-bound regression. The app stores dates
    // as TZ-free YYYY-MM-DD; running e2e in LA proves the wire format and
    // pickers stay consistent regardless of viewer zone. See ADR / docs.
    timezoneId: "America/Los_Angeles",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 120_000,
    env: {
      PLAYWRIGHT_TEST: "1",
    },
  },
});
