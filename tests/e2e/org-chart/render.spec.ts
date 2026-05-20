/**
 * E2E: /org-chart render smoke + collapse interaction.
 *
 * react-d3-tree renders to SVG `<foreignObject>` containing our NodeCard
 * buttons. The seed user names ("Casey V", "Morgan Lee", "Riley Patel")
 * give us anchors to assert against.
 */
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";

test.describe("/org-chart", () => {
  test("MANAGER sees the chart with seeded user names", async ({ page }) => {
    await loginAs(page, "MANAGER");
    await page.goto("/org-chart");

    // Wait for at least one node card to appear (react-d3-tree mounts
    // async via dynamic import).
    await expect(page.getByText(/Casey Vaudit/i)).toBeVisible();
    await expect(page.getByText(/Morgan Lee/i)).toBeVisible();
    await expect(page.getByText(/Riley Patel/i)).toBeVisible();
  });

  test("collapsing a node hides its descendants", async ({ page }) => {
    await loginAs(page, "MANAGER");
    await page.goto("/org-chart");

    // Sanity: descendant is visible to start.
    await expect(page.getByText(/Riley Patel/i)).toBeVisible();
    // Click the Morgan Lee node (the toggle is the node button).
    await page.getByRole("button", { name: /Toggle Morgan Lee/i }).click();
    // After collapse Riley should not be visible anymore.
    await expect(page.getByText(/Riley Patel/i)).toBeHidden();
  });
});

test.describe("/org-chart mobile viewport", () => {
  // Set a mobile viewport to verify the pinch-hint mobile copy renders.
  test.use({ viewport: { width: 390, height: 800 } });

  test("renders the pinch-to-zoom hint on small viewports", async ({
    page,
  }) => {
    await loginAs(page, "MANAGER");
    await page.goto("/org-chart");
    await expect(page.getByText(/pinch to zoom/i)).toBeVisible();
  });
});
