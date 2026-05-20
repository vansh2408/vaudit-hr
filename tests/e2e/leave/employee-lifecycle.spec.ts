/**
 * E2E leave lifecycle: submit → manager approve → employee cancel.
 *
 * The leave form's DateRangePicker is a calendar popover that's painful
 * to drive deterministically across timezones. We exercise the SUBMIT
 * step via the JSON API (same code path the form uses), then drive the
 * UI for the approval + cancellation halves where the human-facing
 * behaviour matters most.
 */
import { eq } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";
import {
  leaveBalances,
  leaveRequests,
  leaveTypes,
  users,
} from "@/lib/db/schema";

const EMPLOYEE_EMAIL = "employee@vaudit.com";

test.describe("leave lifecycle", () => {
  test.afterEach(async () => {
    // Clean up any leave requests we created for the seeded employee so
    // subsequent specs see a deterministic state. Balances are reset.
    const { db } = await import("@/lib/db");
    const me = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, EMPLOYEE_EMAIL))
      .limit(1);
    const id = me[0]?.id;
    if (!id) return;
    await db.delete(leaveRequests).where(eq(leaveRequests.employeeId, id));
    await db
      .update(leaveBalances)
      .set({ used: 0 })
      .where(eq(leaveBalances.employeeId, id));
  });

  test("employee submits, manager approves, employee cancels with refund", async ({
    browser,
  }) => {
    // ---- Setup ----
    const { db } = await import("@/lib/db");
    const empCtx = await browser.newContext();
    const empPage = await empCtx.newPage();
    await loginAs(empPage, "EMPLOYEE");

    const annualLt = await db
      .select({ id: leaveTypes.id })
      .from(leaveTypes)
      .where(eq(leaveTypes.name, "Annual"))
      .limit(1);
    const leaveTypeId = annualLt[0]?.id;
    expect(leaveTypeId).toBeTruthy();
    if (!leaveTypeId) throw new Error("Annual leave type missing in seed");

    // ---- 1. EMPLOYEE submits a leave request via API (3 working days) ----
    // Pick a Mon–Wed range in the far future to avoid weekend math.
    const submitRes = await empPage.request.post("/api/leave", {
      data: {
        leaveTypeId,
        // 2099-01-05 is a Monday; 2099-01-07 a Wednesday → 3 working days.
        startDate: "2099-01-05",
        endDate: "2099-01-07",
        reason: "Annual time off",
      },
    });
    expect(submitRes.ok()).toBe(true);
    const submitBody = (await submitRes.json()) as { id: string; totalDays: number };
    expect(submitBody.totalDays).toBe(3);
    const requestId = submitBody.id;

    // ---- 2. Confirm the request appears in /leave as PENDING ----
    await empPage.goto("/leave");
    // The list renders the request inside a table; the StatusBadge text
    // matches the literal status.
    await expect(empPage.getByText("PENDING").first()).toBeVisible();

    // ---- 3. MANAGER logs in, sees the request in /approvals/Leave tab ----
    const mgrCtx = await browser.newContext();
    const mgrPage = await mgrCtx.newPage();
    await loginAs(mgrPage, "MANAGER");
    await mgrPage.goto("/approvals");
    // Tab default is "leave" — verify the seeded employee's row appears.
    await expect(mgrPage.getByText(/Riley Patel/)).toBeVisible();

    // Click Approve on the matching row and confirm the popover.
    // There may be other rows already; scope to the row containing the
    // employee's name.
    const row = mgrPage.getByRole("row").filter({ hasText: /Riley Patel/ });
    await row.getByRole("button", { name: /^Approve$/ }).click();
    // The popover renders a second "Approve" button.
    await mgrPage
      .getByRole("button", { name: /^Approve$/ })
      .last()
      .click();
    // Toast confirms approval.
    await expect(mgrPage.getByText(/approved/i).first()).toBeVisible();

    // ---- 4. EMPLOYEE views the now-APPROVED request and cancels ----
    await empPage.goto(`/leave/${requestId}`);
    await expect(empPage.getByText("APPROVED").first()).toBeVisible();

    await empPage
      .getByRole("button", { name: /Cancel leave request/i })
      .click();
    // ConfirmDialog: click the destructive confirm.
    await empPage.getByRole("button", { name: /^Cancel request$/ }).click();
    await expect(empPage.getByText(/balance refunded/i).first()).toBeVisible();

    // ---- 5. Verify in the DB that the request is CANCELLED and used=0 ----
    const me = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, EMPLOYEE_EMAIL))
      .limit(1);
    const empId = me[0]?.id;
    expect(empId).toBeTruthy();
    if (!empId) throw new Error("employee id missing");
    const after = await db
      .select({ status: leaveRequests.status })
      .from(leaveRequests)
      .where(eq(leaveRequests.id, requestId));
    expect(after[0]?.status).toBe("CANCELLED");

    const bal = await db
      .select({ used: leaveBalances.used })
      .from(leaveBalances)
      .where(eq(leaveBalances.employeeId, empId));
    expect(bal.every((b) => b.used === 0)).toBe(true);

    // NOTE: `notifyEmployee` fires Slack from the server-side fetch path,
    // not from any browser context, so `mockSlack` does not see those
    // calls. The behavioural assertions above (toast + status + balance)
    // confirm the user-facing flow worked even when Slack is unreachable
    // — exactly what A2 requires.

    await empCtx.close();
    await mgrCtx.close();
  });
});
