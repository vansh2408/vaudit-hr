/**
 * Inline test-data factories.
 *
 * Bypass the UI for setup-only data so individual specs stay fast and
 * focused. Each factory accepts a Drizzle client (defaults to the global
 * `db`) so callers can wrap creation inside their own transactions when
 * needed.
 *
 * The `@/lib/db` module throws at import time if `DATABASE_URL` is not
 * set, which would break Playwright's `--list` flow in environments
 * without a configured DB. To keep test discovery cheap, all helpers
 * dynamically import the global `db` lazily. Callers may inject their
 * own client to opt out of the lazy import.
 *
 * Cleanup: every spec that creates fixtures must clean up after itself —
 * either by deleting rows it created or by letting the user-cascade do
 * it. We deliberately do NOT auto-cleanup here; the spec author knows
 * best when to tear down.
 */
import { and, eq } from "drizzle-orm";
import {
  leaveBalances,
  leaveRequests,
  leaveTypes,
  users,
  wfhRequests,
  type RequestStatus,
} from "@/lib/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { schema as dbSchema } from "@/lib/db";

type Db = NodePgDatabase<typeof dbSchema>;

async function lazyDb(injected: Db | undefined): Promise<Db> {
  if (injected) return injected;
  const mod = await import("@/lib/db");
  return mod.db;
}

const SEEDED_EMAILS = {
  EMPLOYEE: "employee@vaudit.com",
  MANAGER: "manager@vaudit.com",
  HR_ADMIN: "admin@vaudit.com",
  SUPER_ADMIN: "ceo@vaudit.com",
} as const;

export async function getSeededUserId(
  role: keyof typeof SEEDED_EMAILS,
  injected?: Db,
): Promise<string> {
  const db = await lazyDb(injected);
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, SEEDED_EMAILS[role]))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) throw new Error(`Seeded user for role ${role} not found`);
  return id;
}

export async function getSeededLeaveTypeId(
  name: string,
  injected?: Db,
): Promise<string> {
  const db = await lazyDb(injected);
  const rows = await db
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(eq(leaveTypes.name, name))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) throw new Error(`Seeded leave type "${name}" not found`);
  return id;
}

interface CreateLeaveRequestOpts {
  employeeId: string;
  leaveTypeId: string;
  startDate: Date | string; // Date kept for compat; string is "YYYY-MM-DD"
  endDate: Date | string;
  totalDays: number;
  status?: RequestStatus;
  reason?: string;
}

function toYmdString(d: Date | string): string {
  if (typeof d === "string") return d;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function createLeaveRequest(
  opts: CreateLeaveRequestOpts,
  injected?: Db,
): Promise<string> {
  const db = await lazyDb(injected);
  const [row] = await db
    .insert(leaveRequests)
    .values({
      employeeId: opts.employeeId,
      leaveTypeId: opts.leaveTypeId,
      startDate: toYmdString(opts.startDate),
      endDate: toYmdString(opts.endDate),
      totalDays: opts.totalDays,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      status: opts.status ?? "PENDING",
    })
    .returning({ id: leaveRequests.id });
  if (!row) throw new Error("createLeaveRequest returned no row");
  return row.id;
}

interface CreateWfhRequestOpts {
  employeeId: string;
  /** Single date for backwards compatibility with existing fixtures. */
  date?: Date | string;
  startDate?: Date | string;
  endDate?: Date | string;
  totalDays?: number;
  status?: RequestStatus;
  reason?: string;
}

export async function createWfhRequest(
  opts: CreateWfhRequestOpts,
  injected?: Db,
): Promise<string> {
  const db = await lazyDb(injected);
  const start = opts.startDate ?? opts.date;
  const end = opts.endDate ?? opts.date ?? opts.startDate;
  if (!start || !end) {
    throw new Error("createWfhRequest needs date or startDate+endDate");
  }
  const [row] = await db
    .insert(wfhRequests)
    .values({
      employeeId: opts.employeeId,
      startDate: toYmdString(start),
      endDate: toYmdString(end),
      totalDays: opts.totalDays ?? 1,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      status: opts.status ?? "PENDING",
    })
    .returning({ id: wfhRequests.id });
  if (!row) throw new Error("createWfhRequest returned no row");
  return row.id;
}

export async function deleteLeaveRequestsFor(
  employeeId: string,
  injected?: Db,
): Promise<void> {
  const db = await lazyDb(injected);
  await db
    .delete(leaveRequests)
    .where(eq(leaveRequests.employeeId, employeeId));
}

export async function deleteWfhRequestsFor(
  employeeId: string,
  injected?: Db,
): Promise<void> {
  const db = await lazyDb(injected);
  await db.delete(wfhRequests).where(eq(wfhRequests.employeeId, employeeId));
}

export async function resetSeededBalance(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  allocated: number,
  used: number,
  injected?: Db,
): Promise<void> {
  const db = await lazyDb(injected);
  await db
    .update(leaveBalances)
    .set({ allocated, used })
    .where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year),
      ),
    );
}

export { SEEDED_EMAILS };
