/**
 * E2E: audit log viewer at /admin/audit-log.
 *
 * Generates an audit-worthy action (a leave approve via the API),
 * navigates to the audit log, filters by action, and verifies the entry
 * is visible.
 */
import { eq } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";
import {
  createLeaveRequest,
  deleteLeaveRequestsFor,
  getSeededLeaveTypeId,
  getSeededUserId,
  resetSeededBalance,
} from "../helpers/factories";
import { auditLogs } from "@/lib/db/schema";

test.describe("/admin/audit-log", () => {
  let employeeId = "";
  let leaveTypeId = "";
  const YEAR = new Date().getFullYear();

  test.beforeEach(async () => {
    employeeId = await getSeededUserId("EMPLOYEE");
    leaveTypeId = await getSeededLeaveTypeId("Annual");
    await resetSeededBalance(employeeId, leaveTypeId, YEAR, 20, 0);
  });

  test.afterEach(async () => {
    await deleteLeaveRequestsFor(employeeId);
    await resetSeededBalance(employeeId, leaveTypeId, YEAR, 20, 0);
  });

  test("HR_ADMIN sees an audit row appear after an approval action", async ({
    page,
  }) => {
    // Seed a PENDING request, then approve it via the API as MANAGER to
    // generate a leave.approve audit log entry.
    const requestId = await createLeaveRequest({
      employeeId,
      leaveTypeId,
      startDate: new Date("2099-05-04"),
      endDate: new Date("2099-05-04"),
      totalDays: 1,
    });

    // The audit log must contain the leave.approve action.
    await loginAs(page, "MANAGER");
    const approveRes = await page.request.patch(`/api/leave/${requestId}`, {
      data: { action: "APPROVE" },
    });
    expect(approveRes.ok()).toBe(true);
    // Force a quick re-check via the DB layer so we know the audit was
    // written before we navigate to the page.
    const { db } = await import("@/lib/db");
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, requestId));
    expect(logs.some((l) => l.action === "leave.approve")).toBe(true);

    // Now sign in as HR_ADMIN to view the audit log.
    await loginAs(page, "HR_ADMIN");
    await page.goto("/admin/audit-log");

    // Filter by action = leave.approve.
    await page.getByRole("combobox", { name: /^Action$/i }).click();
    await page.getByRole("option", { name: /^leave\.approve$/ }).click();

    await expect(page.getByText("leave.approve").first()).toBeVisible();
    // The metadata column renders JSON; for a leave.approve row it should
    // contain the totalHalfDays key the route writes (post the totalDays
    // -> totalHalfDays rename).
    await expect(page.getByText(/totalHalfDays/).first()).toBeVisible();
  });
});
