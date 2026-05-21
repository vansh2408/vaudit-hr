/**
 * Tests for the /api/leave GET auth scoping — specifically the
 * "manager can list their direct reports' rows" branch added with the
 * /team feature. The handler's resolution of `?employeeId` is:
 *
 *   - omitted                       → caller's own rows
 *   - ?employeeId=self              → caller's own rows
 *   - ?employeeId=other, isAdmin    → other's rows
 *   - ?employeeId=other, caller is
 *     other's direct manager        → other's rows
 *   - anything else                 → silently coerce to caller's own rows
 *
 * /api/wfh GET uses the same logic verbatim — we sanity-check leave only
 * so the test stays focused on the shared predicate, not duplicated boilerplate.
 *
 * Mocking strategy: `@/lib/auth/config` is mocked so `requireSession()` reads
 * a hoisted state we mutate per-case. Everything below the auth layer (db,
 * drizzle, route handler) is real.
 */
import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";

import { closeTestPool } from "../../e2e/helpers/db";
import { leaveRequests, leaveTypes, users } from "@/lib/db/schema";

const HAS_TEST_DB =
  !!process.env["DATABASE_URL_TEST"] || !!process.env["DATABASE_URL"];
const dbDescribe = HAS_TEST_DB ? describe : describe.skip;

// `vi.hoisted` lets the mock factory below close over a mutable cell whose
// value we change per-test. Without this, the mock factory runs before any
// module-level `let` is assigned and we'd be stuck returning the same session.
const mockState = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockState.session,
  handlers: {},
  signIn: () => undefined,
  signOut: () => undefined,
  authConfig: {},
}));

function sessionFor(opts: {
  id: string;
  role: "EMPLOYEE" | "HR_ADMIN" | "SUPER_ADMIN";
  isManager?: boolean;
}): Session {
  return {
    user: {
      id: opts.id,
      name: "Test User",
      email: `${opts.id}@test.vaudit.com`,
      image: null,
      role: opts.role,
      employeeId: opts.id,
      isManager: opts.isManager ?? false,
    },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as Session;
}

function uniqueEmail(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}@test.vaudit.com`;
}

interface Fixture {
  managerId: string;
  employeeId: string;
  outsiderId: string;
  adminId: string;
  leaveTypeId: string;
  empLeaveId: string;
}

async function seed(): Promise<Fixture> {
  const { db } = await import("@/lib/db");
  const [mgr] = await db
    .insert(users)
    .values({
      email: uniqueEmail("auth-mgr"),
      firstName: "Auth",
      lastName: "Mgr",
      role: "EMPLOYEE",
    })
    .returning();
  if (!mgr) throw new Error("mgr fixture missing");
  const [emp] = await db
    .insert(users)
    .values({
      email: uniqueEmail("auth-emp"),
      firstName: "Auth",
      lastName: "Emp",
      role: "EMPLOYEE",
      managerId: mgr.id,
    })
    .returning();
  if (!emp) throw new Error("emp fixture missing");
  const [outsider] = await db
    .insert(users)
    .values({
      email: uniqueEmail("auth-out"),
      firstName: "Auth",
      lastName: "Out",
      role: "EMPLOYEE",
    })
    .returning();
  if (!outsider) throw new Error("outsider fixture missing");
  const [admin] = await db
    .insert(users)
    .values({
      email: uniqueEmail("auth-adm"),
      firstName: "Auth",
      lastName: "Adm",
      role: "HR_ADMIN",
    })
    .returning();
  if (!admin) throw new Error("admin fixture missing");
  const [lt] = await db
    .insert(leaveTypes)
    .values({
      name: `AuthTest-${emp.id.slice(0, 8)}`,
      defaultBalance: 10,
      isPaid: true,
      color: "#000000",
    })
    .returning();
  if (!lt) throw new Error("leaveType fixture missing");
  const [req] = await db
    .insert(leaveRequests)
    .values({
      employeeId: emp.id,
      leaveTypeId: lt.id,
      startDate: "2099-06-01",
      endDate: "2099-06-03",
      totalDays: 6, // 3 working days × 2 half-day units (post-0006)
      status: "APPROVED",
    })
    .returning();
  if (!req) throw new Error("leave request fixture missing");
  return {
    managerId: mgr.id,
    employeeId: emp.id,
    outsiderId: outsider.id,
    adminId: admin.id,
    leaveTypeId: lt.id,
    empLeaveId: req.id,
  };
}

async function cleanup(fx: Fixture): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.delete(leaveRequests).where(eq(leaveRequests.id, fx.empLeaveId));
  for (const id of [fx.employeeId, fx.managerId, fx.outsiderId, fx.adminId]) {
    await db.delete(users).where(eq(users.id, id));
  }
  await db.delete(leaveTypes).where(eq(leaveTypes.id, fx.leaveTypeId));
}

async function callGet(
  url: string,
): Promise<{ status: number; items: Array<{ id: string; employeeId: string }> }> {
  const { GET } = await import("@/app/api/leave/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(url);
  const res = await GET(req);
  const body = (await res.json()) as {
    items?: Array<{ id: string; employeeId: string }>;
  };
  return { status: res.status, items: body.items ?? [] };
}

dbDescribe("/api/leave GET — auth scoping", () => {
  afterEach(() => {
    mockState.session = null;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("manager-of-target may list their direct report's rows", async () => {
    const fx = await seed();
    try {
      mockState.session = sessionFor({
        id: fx.managerId,
        role: "EMPLOYEE",
        isManager: true,
      });
      const { status, items } = await callGet(
        `http://localhost/api/leave?employeeId=${fx.employeeId}`,
      );
      expect(status).toBe(200);
      // The manager should see at least the seeded row, and every row
      // returned must belong to the target employee — not silently
      // coerced to the manager's own (empty) feed.
      expect(items.map((i) => i.id)).toContain(fx.empLeaveId);
      for (const r of items) {
        expect(r.employeeId).toBe(fx.employeeId);
      }
    } finally {
      await cleanup(fx);
    }
  });

  it("non-manager outsider asking for someone else's data is coerced to self", async () => {
    const fx = await seed();
    try {
      mockState.session = sessionFor({
        id: fx.outsiderId,
        role: "EMPLOYEE",
      });
      const { status, items } = await callGet(
        `http://localhost/api/leave?employeeId=${fx.employeeId}`,
      );
      expect(status).toBe(200);
      // The outsider's own rows are empty; crucially the employee's row
      // must NOT appear — the silent coercion still has to scope to self.
      expect(items.map((i) => i.id)).not.toContain(fx.empLeaveId);
      for (const r of items) {
        expect(r.employeeId).toBe(fx.outsiderId);
      }
    } finally {
      await cleanup(fx);
    }
  });

  it("admin may list any employee's rows via ?employeeId", async () => {
    const fx = await seed();
    try {
      mockState.session = sessionFor({
        id: fx.adminId,
        role: "HR_ADMIN",
      });
      const { status, items } = await callGet(
        `http://localhost/api/leave?employeeId=${fx.employeeId}`,
      );
      expect(status).toBe(200);
      expect(items.map((i) => i.id)).toContain(fx.empLeaveId);
    } finally {
      await cleanup(fx);
    }
  });

  it("self (no ?employeeId) returns caller's own rows", async () => {
    const fx = await seed();
    try {
      mockState.session = sessionFor({
        id: fx.employeeId,
        role: "EMPLOYEE",
      });
      const { status, items } = await callGet(`http://localhost/api/leave`);
      expect(status).toBe(200);
      expect(items.map((i) => i.id)).toContain(fx.empLeaveId);
    } finally {
      await cleanup(fx);
    }
  });
});