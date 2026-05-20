/**
 * E2E: admin employee CRUD via /admin/employees.
 *
 *   - Add: form submission creates a user + auto-creates balances.
 *   - Edit: a phone-number change persists.
 *   - Deactivate: confirm dialog flow flips isActive and auto-cancels pending
 *     requests via the existing /api/admin/employees/[id] DELETE handler.
 *   - Authz: MANAGER cannot reach /admin/employees.
 */
import { eq, inArray } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";
import {
  auditLogs,
  leaveBalances,
  leaveRequests,
  users,
} from "@/lib/db/schema";
import {
  createLeaveRequest,
  deleteLeaveRequestsFor,
  getSeededLeaveTypeId,
} from "../helpers/factories";

const TEST_EMAIL_PREFIX = "e2e-crud-";

function uniqueEmail(label: string): string {
  const stamp = Date.now().toString(36);
  return `${TEST_EMAIL_PREFIX}${label}-${stamp}@vaudit.com`;
}

async function cleanupByEmail(emailPrefix: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, emailPrefix));
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  for (const id of ids) {
    await db.delete(auditLogs).where(eq(auditLogs.targetId, id));
  }
  await db.delete(users).where(inArray(users.id, ids));
}

test.describe("admin employees CRUD", () => {
  test("HR_ADMIN adds a new employee; row appears in list and balances are auto-created", async ({
    page,
  }) => {
    const email = uniqueEmail("add");
    try {
      await loginAs(page, "HR_ADMIN");
      await page.goto("/admin/employees/new");
      await page.getByLabel(/First name/i).fill("Add");
      await page.getByLabel(/Last name/i).fill("Test");
      await page.getByLabel(/^Email$/i).fill(email);
      await page.getByLabel(/Position/i).fill("Engineer");
      await page.getByLabel(/Department/i).fill("R&D");

      await page
        .getByRole("button", { name: /Create employee/i })
        .click();
      await expect(page.getByText(/Employee created/i)).toBeVisible();

      // Verify in DB.
      const { db } = await import("@/lib/db");
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      expect(rows).toHaveLength(1);
      const id = rows[0]?.id;
      expect(id).toBeTruthy();
      if (!id) throw new Error("created user id missing");

      const bals = await db
        .select({ leaveTypeId: leaveBalances.leaveTypeId })
        .from(leaveBalances)
        .where(eq(leaveBalances.employeeId, id));
      expect(bals.length).toBeGreaterThan(0);
    } finally {
      await cleanupByEmail(email);
    }
  });

  test("HR_ADMIN edits an employee's phone and the change persists", async ({
    page,
  }) => {
    const email = uniqueEmail("edit");
    // Seed the user via the API so we don't depend on the create flow.
    await loginAs(page, "HR_ADMIN");
    const createRes = await page.request.post("/api/admin/employees", {
      data: {
        firstName: "Edit",
        lastName: "Me",
        email,
        role: "EMPLOYEE",
      },
    });
    expect(createRes.ok()).toBe(true);
    const created = (await createRes.json()) as { id: string };
    try {
      await page.goto(`/admin/employees/${created.id}`);
      const phone = page.getByLabel(/^Phone$/i);
      await phone.fill("+1-555-0007");
      await page.getByRole("button", { name: /Save changes/i }).click();
      await expect(page.getByText(/Saved/i).first()).toBeVisible();

      const { db } = await import("@/lib/db");
      const after = await db
        .select({ phone: users.phone })
        .from(users)
        .where(eq(users.id, created.id));
      expect(after[0]?.phone).toBe("+1-555-0007");
    } finally {
      await cleanupByEmail(email);
    }
  });

  test("HR_ADMIN deactivates an employee with a PENDING leave; status flips and request is auto-cancelled", async ({
    page,
  }) => {
    const email = uniqueEmail("deact");
    await loginAs(page, "HR_ADMIN");

    // Create user via API.
    const createRes = await page.request.post("/api/admin/employees", {
      data: {
        firstName: "Deact",
        lastName: "Target",
        email,
        role: "EMPLOYEE",
      },
    });
    expect(createRes.ok()).toBe(true);
    const created = (await createRes.json()) as { id: string };

    // Seed a PENDING leave request for them.
    const leaveTypeId = await getSeededLeaveTypeId("Annual");
    const reqId = await createLeaveRequest({
      employeeId: created.id,
      leaveTypeId,
      startDate: new Date("2099-04-02"),
      endDate: new Date("2099-04-02"),
      totalDays: 1,
    });

    try {
      await page.goto(`/admin/employees/${created.id}`);
      await page
        .getByRole("button", { name: /Deactivate employee/i })
        .click();
      // ConfirmDialog: the destructive label is "Deactivate".
      await page
        .getByRole("button", { name: /^Deactivate$/ })
        .click();
      await expect(page.getByText(/Employee deactivated/i)).toBeVisible();

      const { db } = await import("@/lib/db");
      const after = await db
        .select({ isActive: users.isActive })
        .from(users)
        .where(eq(users.id, created.id));
      expect(after[0]?.isActive).toBe(false);

      const lr = await db
        .select({ status: leaveRequests.status })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, reqId));
      expect(lr[0]?.status).toBe("CANCELLED");
    } finally {
      await deleteLeaveRequestsFor(created.id);
      await cleanupByEmail(email);
    }
  });

  test("MANAGER cannot access /admin/employees (redirected or forbidden)", async ({
    page,
  }) => {
    await loginAs(page, "MANAGER");
    await page.goto("/admin/employees", { waitUntil: "domcontentloaded" });
    // The admin page calls `requireAdmin()` server-side; non-admins get a
    // Next.js redirect or notFound, not a render of the employees list.
    // Verify we either landed away from /admin/employees OR see no list.
    // Either redirect away or render an empty / not-found shell — accept
    // both. The critical guarantee is that we never see the admin-only
    // "Add employee" CTA.
    await expect(
      page.getByRole("link", { name: /Add employee/i }),
    ).toHaveCount(0);
  });
});
