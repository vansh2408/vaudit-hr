/**
 * Request timeline — chronological view of audit log entries scoped to a
 * single leave or WFH request.
 *
 * The audit_logs table is already the canonical record of every state
 * change (create, edit, approve, reject, cancel, auto_cancel). This module
 * reads them back ordered by createdAt, joins each row to its actor in
 * `users`, and returns a typed array the UI can render directly.
 *
 * Lives under lib/audit/ rather than lib/leave/ because it is shape-agnostic:
 * the same fetcher serves leave_requests and wfh_requests (and could serve
 * any other audited resource later).
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";

export type RequestTimelineTable = "leave_requests" | "wfh_requests";

export interface TimelineEntry {
  id: string;
  action: string;
  /** Null when the actor was deleted or the action was system-issued. */
  actorId: string | null;
  /** Display name (first + last). Null if actor record is gone. */
  actorName: string | null;
  /** ISO 8601 string in UTC; format with formatInstant in the UI. */
  createdAt: string;
  /**
   * Audit metadata payload. Shape varies by action — `edit` carries
   * { before, after }, `approve/reject` carries reviewer-context fields,
   * `cancel_*` carries totalDays + previousStatus, etc. Treated as opaque
   * here; the renderer inspects keys as needed.
   */
  metadata: Record<string, unknown>;
}

export async function getRequestTimeline(
  targetTable: RequestTimelineTable,
  targetId: string,
): Promise<TimelineEntry[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorId: auditLogs.actorId,
      actorFirstName: users.firstName,
      actorLastName: users.lastName,
      createdAt: auditLogs.createdAt,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    // leftJoin so a deleted actor (set null on delete) still surfaces the row.
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(
      and(
        eq(auditLogs.targetTable, targetTable),
        eq(auditLogs.targetId, targetId),
      ),
    )
    .orderBy(asc(auditLogs.createdAt));

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actorId,
    actorName:
      r.actorFirstName && r.actorLastName
        ? `${r.actorFirstName} ${r.actorLastName}`
        : null,
    createdAt: r.createdAt.toISOString(),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }));
}