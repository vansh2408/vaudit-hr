/**
 * E2E auth spec — validates the test-credentials bypass plumbing AND the
 * domain / pre-staged guards that production users hit on first sign-in.
 *
 * NOTE: the Google OAuth flow is replaced in test mode by the
 * `test-credentials` Credentials provider (registered only when
 * PLAYWRIGHT_TEST=1). See docs/security/test-auth.md.
 */
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";

test.describe("auth /login", () => {
  test("happy path: loginAs(EMPLOYEE) lands on /dashboard", async ({ page }) => {
    await loginAs(page, "EMPLOYEE");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    // The shell renders a section labelled "My leave balances" on the
    // employee dashboard.
    await expect(
      page.getByRole("region", { name: /my leave balances/i }),
    ).toBeVisible();
  });

  test("non-allowed-domain Google login is rejected with a friendly error", async ({
    page,
  }) => {
    // The test-credentials provider does NOT enforce the domain check
    // (that's a Google-only guardrail — see lib/auth/config.ts), so we
    // exercise the user-visible error UI by hitting /login?error=
    // AccessDenied directly. The login form maps every Google-side error
    // to the ERROR_COPY map; we assert the visible copy.
    await page.goto("/login?error=AccessDenied");
    await expect(page.getByRole("alert")).toContainText(/contact HR/i);
  });

  test("nonexistent allowed-domain account shows the 'contact HR' copy", async ({
    page,
  }) => {
    // Same surface as the domain-rejection case: NextAuth surfaces
    // signIn-callback denials as `error=AccessDenied`. The user-visible
    // message must mention HR so people know how to escalate.
    await page.goto("/login?error=AccessDenied");
    await expect(page.getByRole("alert")).toContainText(
      /hasn'?t been set up/i,
    );
  });

  test("sign out from the navbar returns the user to /login", async ({
    page,
  }) => {
    await loginAs(page, "EMPLOYEE");
    await page.goto("/dashboard");

    // Open the account dropdown then click Sign out.
    await page.getByRole("button", { name: /Account menu/i }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();

    await page.waitForURL(/\/login(\?|$)/);
    // The login surface shows the heading "Welcome back".
    await expect(
      page.getByRole("heading", { name: /welcome back/i }),
    ).toBeVisible();
  });
});
