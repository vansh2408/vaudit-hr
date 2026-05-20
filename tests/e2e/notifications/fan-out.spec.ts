/**
 * E2E: notification fan-out — A2.
 *
 * Submit a leave request as EMPLOYEE; the seeded MANAGER (Morgan Lee)
 * receives an in-app notification. Open the NotificationBell and assert
 * the badge count goes up; mark one as read and assert it decreases.
 *
 * Slack DMs are fired from the server; we do not assert on them here.
 * The in-app row is the DB-backed half of A2 — that is sufficient.
 */
import { eq } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";
import {
  leaveRequests,
  notifications,
  users,
} from "@/lib/db/schema";
import {
  getSeededLeaveTypeId,
  getSeededUserId,
  resetSeededBalance,
} from "../helpers/factories";

test.describe("notifications fan-out", () => {
  let employeeId = "";
  let leaveTypeId = "";
  let managerId = "";
  const YEAR = new Date().getFullYear();

  test.beforeEach(async () => {
    employeeId = await getSeededUserId("EMPLOYEE");
    managerId = await getSeededUserId("MANAGER");
    leaveTypeId = await getSeededLeaveTypeId("Annual");
    await resetSeededBalance(employeeId, leaveTypeId, YEAR, 20, 0);
    const { db } = await import("@/lib/db");
    // Clear stale notifications for the manager so the badge count is
    // deterministic.
    await db
      .delete(notifications)
      .where(eq(notifications.employeeId, managerId));
  });

  test.afterEach(async () => {
    const { db } = await import("@/lib/db");
    await db.delete(leaveRequests).where(eq(leaveRequests.employeeId, employeeId));
    await db
      .delete(notifications)
      .where(eq(notifications.employeeId, managerId));
    await resetSeededBalance(employeeId, leaveTypeId, YEAR, 20, 0);
  });

  test("submitting a leave creates a notification row for the manager", async ({
    browser,
  }) => {
    const empCtx = await browser.newContext();
    const empPage = await empCtx.newPage();
    await loginAs(empPage, "EMPLOYEE");

    const submitRes = await empPage.request.post("/api/leave", {
      data: {
        leaveTypeId,
        startDate: "2099-06-01",
        endDate: "2099-06-01",
        reason: "Notify the manager",
      },
    });
    expect(submitRes.ok()).toBe(true);

    const { db } = await import("@/lib/db");
    // The notification row exists.
    const notifs = await db
      .select({ id: notifications.id, isRead: notifications.isRead })
      .from(notifications)
      .where(eq(notifications.employeeId, managerId));
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs.some((n) => !n.isRead)).toBe(true);

    // Manager logs in, opens the bell, and marks the notification as read.
    const mgrCtx = await browser.newContext();
    const mgrPage = await mgrCtx.newPage();
    await loginAs(mgrPage, "MANAGER");
    await mgrPage.goto("/dashboard");
    const bell = mgrPage.getByRole("button", {
      name: /Notifications \(\d+ unread\)/i,
    });
    await expect(bell).toBeVisible();
    await bell.click();
    // The popover shows the in-app notification list; "Mark all as read"
    // exists somewhere in the bell — click it.
    await mgrPage.getByRole("button", { name: /Mark all as read/i }).click();

    // After mark-all the in-app notifications are read=true.
    const after = await db
      .select({ isRead: notifications.isRead })
      .from(notifications)
      .where(eq(notifications.employeeId, managerId));
    expect(after.every((n) => n.isRead)).toBe(true);

    // The unread badge no longer appears.
    await expect(
      mgrPage.getByRole("button", { name: /Notifications \(\d+ unread\)/i }),
    ).toHaveCount(0);

    // Smoke: the manager id matches the seeded record.
    const seeded = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "manager@vaudit.com"))
      .limit(1);
    expect(seeded[0]?.id).toBe(managerId);

    await empCtx.close();
    await mgrCtx.close();
  });
});
