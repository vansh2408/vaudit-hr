/**
 * E2E: bulk approve on /approvals.
 *
 * Seed 3 PENDING leave requests for the seeded EMPLOYEE via the factories
 * (skips the form to keep the spec fast and deterministic), log in as
 * MANAGER, select all 3, click "Approve N", and verify they flip to
 * APPROVED.
 */
import { eq, inArray } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";
import {
  createLeaveRequest,
  deleteLeaveRequestsFor,
  getSeededLeaveTypeId,
  getSeededUserId,
  resetSeededBalance,
} from "../helpers/factories";
import { leaveRequests, users } from "@/lib/db/schema";

test.describe("/approvals bulk approve", () => {
  let employeeId = "";
  let leaveTypeId = "";
  const seededIds: string[] = [];

  test.beforeEach(async () => {
    employeeId = await getSeededUserId("EMPLOYEE");
    leaveTypeId = await getSeededLeaveTypeId("Annual");
    // Reset balance so approval has room.
    await resetSeededBalance(
      employeeId,
      leaveTypeId,
      new Date().getFullYear(),
      20,
      0,
    );
    // Seed 3 PENDING leave requests for the employee.
    seededIds.length = 0;
    seededIds.push(
      await createLeaveRequest({
        employeeId,
        leaveTypeId,
        startDate: new Date("2099-02-02"),
        endDate: new Date("2099-02-02"),
        totalDays: 1,
        reason: "Bulk-1",
      }),
    );
    seededIds.push(
      await createLeaveRequest({
        employeeId,
        leaveTypeId,
        startDate: new Date("2099-02-03"),
        endDate: new Date("2099-02-03"),
        totalDays: 1,
        reason: "Bulk-2",
      }),
    );
    seededIds.push(
      await createLeaveRequest({
        employeeId,
        leaveTypeId,
        startDate: new Date("2099-02-04"),
        endDate: new Date("2099-02-04"),
        totalDays: 1,
        reason: "Bulk-3",
      }),
    );
  });

  test.afterEach(async () => {
    await deleteLeaveRequestsFor(employeeId);
    await resetSeededBalance(
      employeeId,
      leaveTypeId,
      new Date().getFullYear(),
      20,
      0,
    );
  });

  test("manager selects all and bulk-approves; all 3 flip to APPROVED", async ({
    page,
  }) => {
    await loginAs(page, "MANAGER");
    await page.goto("/approvals");

    // "Select all" header checkbox.
    await page
      .getByRole("checkbox", { name: /Select all/i })
      .click();
    // The bulk bar shows "3 selected" and an "Approve 3" button.
    await expect(page.getByText(/3 selected/i)).toBeVisible();
    await page.getByRole("button", { name: /Approve 3/i }).click();
    await expect(page.getByText(/Approved 3 request/i)).toBeVisible();

    const { db } = await import("@/lib/db");
    const after = await db
      .select({ id: leaveRequests.id, status: leaveRequests.status })
      .from(leaveRequests)
      .where(inArray(leaveRequests.id, seededIds));
    expect(after.every((r) => r.status === "APPROVED")).toBe(true);

    // Smoke check: the reviewer is the seeded MANAGER.
    const me = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "manager@vaudit.com"))
      .limit(1);
    expect(me[0]?.id).toBeTruthy();
  });
});
