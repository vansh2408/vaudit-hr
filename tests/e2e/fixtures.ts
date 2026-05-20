/**
 * Playwright fixtures for Vaudit HR.
 *
 * - `authedAs(role)` — drop-in factory that returns a `test` object whose
 *   `page` fixture is pre-logged-in as the seeded user for that role.
 * - `mockSlack` — auto-fixture that intercepts every outbound request to
 *   `https://slack.com/api/*` and returns `{ ok: true }`. Tests that
 *   verify Slack call shape can still inspect `mockSlack.calls`.
 *
 * Usage:
 *   import { test, expect } from "../fixtures";
 *   test("admin can open employees page", async ({ page, mockSlack }) => {
 *     await loginAs(page, "HR_ADMIN");
 *     await page.goto("/admin/employees");
 *     expect(mockSlack.calls).toHaveLength(0);
 *   });
 */
import { test as base, type Page } from "@playwright/test";
import { loginAs, type SeededRole } from "./helpers/auth";

interface SlackCall {
  url: string;
  body: unknown;
}

interface MockSlack {
  calls: SlackCall[];
  reset: () => void;
}

interface VauditFixtures {
  mockSlack: MockSlack;
}

export const test = base.extend<VauditFixtures>({
  // eslint-disable-next-line no-empty-pattern
  mockSlack: async ({ page }, use) => {
    const slack: MockSlack = {
      calls: [],
      reset(): void {
        this.calls = [];
      },
    };
    await page.route("https://slack.com/api/**", async (route) => {
      const req = route.request();
      let body: unknown = null;
      try {
        body = JSON.parse(req.postData() ?? "null");
      } catch {
        body = req.postData();
      }
      slack.calls.push({ url: req.url(), body });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, channel: { id: "C_TEST" } }),
      });
    });
    await use(slack);
  },
});

export { expect } from "@playwright/test";

/**
 * Build a derived test factory whose `page` fixture is pre-logged-in.
 *
 *   const test = authedAs("HR_ADMIN");
 *   test("...", async ({ page }) => { ... });
 */
export function authedAs(role: SeededRole): typeof test {
  return test.extend<{ page: Page }>({
    page: async ({ page }, use) => {
      await loginAs(page, role);
      await use(page);
    },
  });
}
