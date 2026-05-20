/**
 * E2E: HR_ADMIN adjusts an employee's allocated balance and the change
 * lands in the dashboard + audit log.
 */
import { and, eq } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";
import {
  auditLogs,
  leaveBalances,
  users,
} from "@/lib/db/schema";
import {
  getSeededLeaveTypeId,
  getSeededUserId,
  resetSeededBalance,
} from "../helpers/factories";

test.describe("/admin/balances", () => {
  let employeeId = "";
  let leaveTypeId = "";
  const YEAR = new Date().getFullYear();

  test.beforeEach(async () => {
    employeeId = await getSeededUserId("EMPLOYEE");
    leaveTypeId = await getSeededLeaveTypeId("Annual");
    await resetSeededBalance(employeeId, leaveTypeId, YEAR, 20, 0);
  });

  test.afterEach(async () => {
    await resetSeededBalance(employeeId, leaveTypeId, YEAR, 20, 0);
    const { db } = await import("@/lib/db");
    await db
      .delete(auditLogs)
      .where(eq(auditLogs.action, "balance.adjust"));
  });

  test("HR_ADMIN bumps allocated; audit log records the change", async ({ page }) => {
    await loginAs(page, "HR_ADMIN");
    await page.goto("/admin/balances");

    // Pick the employee in the dropdown. The trigger is labelled "Employee".
    await page.getByRole("combobox", { name: /^Employee$/i }).click();
    // The seed names the employee "Riley Patel".
    await page
      .getByRole("option", { name: /Riley Patel/i })
      .click();

    // Find the Annual row's allocated input and bump it.
    const allocInput = page.getByRole("spinbutton", {
      name: /Allocated days for Annual/i,
    });
    await allocInput.fill("25");
    // The corresponding Save button on that row.
    await page.getByRole("button", { name: /^Save$/ }).first().click();
    await expect(page.getByText(/Annual balance updated/i)).toBeVisible();

    const { db } = await import("@/lib/db");
    const after = await db
      .select({ allocated: leaveBalances.allocated })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.employeeId, employeeId),
          eq(leaveBalances.leaveTypeId, leaveTypeId),
          eq(leaveBalances.year, YEAR),
        ),
      );
    expect(after[0]?.allocated).toBe(25);

    // Audit log: a balance.adjust row exists for this actor + target.
    const me = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "admin@vaudit.com"))
      .limit(1);
    const actorId = me[0]?.id;
    expect(actorId).toBeTruthy();
    if (!actorId) throw new Error("actor id missing");

    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.actorId, actorId), eq(auditLogs.action, "balance.adjust")),
      );
    expect(logs.length).toBeGreaterThan(0);
  });
});
