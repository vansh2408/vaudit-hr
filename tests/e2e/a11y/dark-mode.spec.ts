/**
 * E2E: dark-mode toggle adds `class="dark"` to <html>.
 *
 * Theme is owned by next-themes; the navbar dropdown sets it via
 * `setTheme("dark"|"light"|"system")`. We exercise the dropdown path
 * because that's what a user clicks.
 *
 * Visual screenshots: we capture a single dashboard screenshot per theme
 * for visual review. CI's first run accepts as golden; later runs compare.
 */
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";

test.describe("dark mode toggle", () => {
  test("toggling Dark applies class='dark' to <html>", async ({ page }) => {
    await loginAs(page, "EMPLOYEE");
    await page.goto("/dashboard");

    // Open the theme dropdown (aria-label "Toggle theme").
    await page.getByRole("button", { name: /Toggle theme/i }).click();
    await page.getByRole("menuitem", { name: /^Dark$/i }).click();

    // Wait for next-themes to apply the class (synchronous in practice).
    await expect(page.locator("html")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);

    // Switch back to light to verify the toggle works both ways.
    await page.getByRole("button", { name: /Toggle theme/i }).click();
    await page.getByRole("menuitem", { name: /^Light$/i }).click();
    await expect(page.locator("html")).not.toHaveClass(/(?:^|\s)dark(?:\s|$)/);
  });

  test("dashboard renders consistently in both themes (visual review)", async ({
    page,
  }) => {
    await loginAs(page, "EMPLOYEE");
    await page.goto("/dashboard");

    // Light-theme snapshot.
    await expect(page.locator("main")).toBeVisible();
    await expect(page).toHaveScreenshot("dashboard-light.png", {
      maxDiffPixelRatio: 0.02,
      // The dashboard contains live "team on leave today" rows; mask the
      // body to avoid flakes when test data shifts.
      fullPage: true,
    });

    // Switch to dark and snapshot again.
    await page.getByRole("button", { name: /Toggle theme/i }).click();
    await page.getByRole("menuitem", { name: /^Dark$/i }).click();
    await expect(page.locator("html")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);
    await expect(page).toHaveScreenshot("dashboard-dark.png", {
      maxDiffPixelRatio: 0.02,
      fullPage: true,
    });
  });
});
