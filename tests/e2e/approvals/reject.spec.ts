/**
 * E2E: reject a pending leave request with required reviewer note.
 *
 * Two assertions:
 *   - Empty note: Reject confirm button is disabled (no submission).
 *   - With note: the request flips to REJECTED and an in-app notification
 *     is queued for the employee.
 */
import { eq } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";
import {
  createLeaveRequest,
  deleteLeaveRequestsFor,
  getSeededLeaveTypeId,
  getSeededUserId,
} from "../helpers/factories";
import { leaveRequests, notifications } from "@/lib/db/schema";

test.describe("/approvals reject flow", () => {
  let employeeId = "";
  let leaveTypeId = "";
  let requestId = "";

  test.beforeEach(async () => {
    employeeId = await getSeededUserId("EMPLOYEE");
    leaveTypeId = await getSeededLeaveTypeId("Annual");
    requestId = await createLeaveRequest({
      employeeId,
      leaveTypeId,
      startDate: new Date("2099-03-02"),
      endDate: new Date("2099-03-02"),
      totalDays: 1,
      reason: "Reject me",
    });
  });

  test.afterEach(async () => {
    await deleteLeaveRequestsFor(employeeId);
    const { db } = await import("@/lib/db");
    await db
      .delete(notifications)
      .where(eq(notifications.employeeId, employeeId));
  });

  test("empty note disables the destructive Reject button (validation)", async ({
    page,
  }) => {
    await loginAs(page, "MANAGER");
    await page.goto("/approvals");

    // Click the row-level "Reject" button (opens the modal).
    await page.getByRole("button", { name: /^Reject$/ }).first().click();
    // The modal's destructive submit button is named "Reject".
    const destructive = page.getByRole("button", { name: /^Reject$/ }).last();
    await expect(destructive).toBeDisabled();
  });

  test("rejecting with a note flips status to REJECTED and notifies the employee", async ({
    page,
  }) => {
    await loginAs(page, "MANAGER");
    await page.goto("/approvals");

    await page.getByRole("button", { name: /^Reject$/ }).first().click();
    await page
      .getByLabel(/Reason/i)
      .fill("Not enough notice for this leave window");
    await page.getByRole("button", { name: /^Reject$/ }).last().click();
    await expect(page.getByText(/rejected/i).first()).toBeVisible();

    const { db } = await import("@/lib/db");
    const after = await db
      .select({ status: leaveRequests.status })
      .from(leaveRequests)
      .where(eq(leaveRequests.id, requestId));
    expect(after[0]?.status).toBe("REJECTED");

    // An in-app notification was queued for the employee. Type matches
    // the leave route's notify call shape.
    const notifs = await db
      .select({ type: notifications.type })
      .from(notifications)
      .where(eq(notifications.employeeId, employeeId));
    expect(notifs.some((n) => /leave/i.test(n.type))).toBe(true);
  });
});
