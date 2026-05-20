/**
 * Overlap detection for leave + WFH requests (0006 half-day support).
 *
 * Rules (V1):
 *   - Two FULL-DAY requests overlapping on any date  → conflict.
 *   - A HALF-DAY request landing on a date already covered by an
 *     overlapping FULL-DAY request                     → conflict.
 *   - Two HALF-DAY requests on the SAME date + SAME slot → conflict.
 *   - Two HALF-DAY requests on the SAME date + DIFFERENT slots → OK
 *     (e.g. half-day leave in the morning, half-day WFH in the afternoon).
 *
 * Scope:
 *   - Considers PENDING, APPROVED, and PENDING_CANCELLATION requests on
 *     either side. Rejected/cancelled rows don't participate.
 *   - Looks across BOTH leave_requests and wfh_requests — an employee
 *     can't have leave and WFH on the same slot of the same day.
 *
 * The caller passes `excludeRequestId` when editing an existing request,
 * so the row being edited doesn't conflict with itself.
 */
import { and, eq, gte, lte, inArray, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as defaultDb } from "@/lib/db";
import type { schema as dbSchema } from "@/lib/db";
import { leaveRequests, wfhRequests } from "@/lib/db/schema";
import type { Ymd } from "@/lib/utils/dates";
import type { HalfDaySlot } from "@/lib/utils/format-days";
import { rowsConflict } from "@/lib/leave/overlap-pure";

export { rowsConflict };

type Db = NodePgDatabase<typeof dbSchema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

const NON_TERMINAL_STATUSES = ["PENDING", "APPROVED", "PENDING_CANCELLATION"] as const;

export interface OverlapCandidate {
  /** "leave" or "wfh" — the table the conflicting row lives in. */
  kind: "leave" | "wfh";
  id: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDaySlot: string | null;
  status: string;
}

export interface OverlapInput {
  employeeId: string;
  startDate: Ymd;
  endDate: Ymd;
  isHalfDay: boolean;
  halfDaySlot: HalfDaySlot | null;
  /** ID of the request being edited (so it doesn't conflict with itself). */
  excludeRequestId?: string;
  /** Which side is this for? Used only to scope the excludeRequestId. */
  excludeKind?: "leave" | "wfh";
}

/**
 * Returns the first conflicting candidate found, or null when clear.
 * We return a *single* candidate (not a list) because the UI just needs
 * to surface "you already have something on that day"; multiple conflicts
 * would still resolve to the same user action.
 */
export async function findOverlap(
  input: OverlapInput,
  client: DbOrTx = defaultDb,
): Promise<OverlapCandidate | null> {
  const { employeeId, startDate, endDate, isHalfDay, halfDaySlot } = input;

  // Pull every non-terminal leave + WFH row whose date range intersects
  // [startDate, endDate]. The intersection test is "row.startDate <=
  // endDate AND row.endDate >= startDate". Drizzle expresses this with
  // two compound predicates; the size is bounded (any one employee has
  // a small number of open requests), so a single fetch is fine.
  const leaveConds = [
    eq(leaveRequests.employeeId, employeeId),
    inArray(leaveRequests.status, [...NON_TERMINAL_STATUSES]),
    lte(leaveRequests.startDate, endDate),
    gte(leaveRequests.endDate, startDate),
  ];
  if (input.excludeKind === "leave" && input.excludeRequestId) {
    leaveConds.push(ne(leaveRequests.id, input.excludeRequestId));
  }
  const wfhConds = [
    eq(wfhRequests.employeeId, employeeId),
    inArray(wfhRequests.status, [...NON_TERMINAL_STATUSES]),
    lte(wfhRequests.startDate, endDate),
    gte(wfhRequests.endDate, startDate),
  ];
  if (input.excludeKind === "wfh" && input.excludeRequestId) {
    wfhConds.push(ne(wfhRequests.id, input.excludeRequestId));
  }

  const [leaveRows, wfhRows] = await Promise.all([
    client
      .select({
        id: leaveRequests.id,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        isHalfDay: leaveRequests.isHalfDay,
        halfDaySlot: leaveRequests.halfDaySlot,
        status: leaveRequests.status,
      })
      .from(leaveRequests)
      .where(and(...leaveConds)),
    client
      .select({
        id: wfhRequests.id,
        startDate: wfhRequests.startDate,
        endDate: wfhRequests.endDate,
        isHalfDay: wfhRequests.isHalfDay,
        halfDaySlot: wfhRequests.halfDaySlot,
        status: wfhRequests.status,
      })
      .from(wfhRequests)
      .where(and(...wfhConds)),
  ]);

  const candidates: OverlapCandidate[] = [
    ...leaveRows.map((r) => ({ kind: "leave" as const, ...r })),
    ...wfhRows.map((r) => ({ kind: "wfh" as const, ...r })),
  ];

  for (const c of candidates) {
    if (rowsConflict(
      { startDate, endDate, isHalfDay, halfDaySlot },
      {
        startDate: c.startDate as Ymd,
        endDate: c.endDate as Ymd,
        isHalfDay: c.isHalfDay,
        halfDaySlot: (c.halfDaySlot as HalfDaySlot | null) ?? null,
      },
    )) {
      return c;
    }
  }
  return null;
}

