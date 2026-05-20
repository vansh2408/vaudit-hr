/**
 * /api/admin/balances
 *  GET   → list balances. Filterable by employeeId + year. Admins only.
 *  PATCH → adjust a single balance row (allocated and/or used). Audit-logged.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leaveBalances, leaveTypes, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import {
  balanceAdjustSchema,
  balanceListQuerySchema,
} from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { parseSearchParams } from "@/lib/api/route-helpers";
import { writeAuditLog } from "@/lib/audit/log";
import { assertSameOrigin } from "@/lib/security/csrf";
import { sanitizeFreeText } from "@/lib/security/sanitize";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const q = parseSearchParams(req.url, balanceListQuerySchema);
    const conds = [];
    if (q.employeeId) conds.push(eq(leaveBalances.employeeId, q.employeeId));
    if (q.year !== undefined) conds.push(eq(leaveBalances.year, q.year));
    const where = conds.length > 0 ? and(...conds) : undefined;
    const rows = await db
      .select({
        id: leaveBalances.id,
        employeeId: leaveBalances.employeeId,
        employeeFirstName: users.firstName,
        employeeLastName: users.lastName,
        leaveTypeId: leaveBalances.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        leaveTypeColor: leaveTypes.color,
        year: leaveBalances.year,
        allocated: leaveBalances.allocated,
        used: leaveBalances.used,
      })
      .from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .innerJoin(users, eq(users.id, leaveBalances.employeeId))
      .where(where);
    return NextResponse.json({ items: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireAdmin();
    const body = balanceAdjustSchema.parse(await req.json());
    if (body.allocated === undefined && body.used === undefined) {
      return apiError(400, "NO_CHANGES", "Provide allocated and/or used");
    }
    // Self-grant guard: an admin must not be able to silently inflate
    // their OWN balance. Goes through a peer admin (or HR via direct DB
    // edit + audit log) to maintain the two-person principle that already
    // applies to role-change and deactivation.
    if (body.employeeId === session.user.id) {
      return apiError(
        403,
        "CANNOT_SELF_EDIT_BALANCE",
        "Admins cannot edit their own balance — ask another admin",
      );
    }
    const safeReason =
      typeof body.reason === "string" && body.reason.length > 0
        ? sanitizeFreeText(body.reason)
        : null;
    const existing = await db
      .select({
        id: leaveBalances.id,
        allocated: leaveBalances.allocated,
        used: leaveBalances.used,
      })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.employeeId, body.employeeId),
          eq(leaveBalances.leaveTypeId, body.leaveTypeId),
          eq(leaveBalances.year, body.year),
        ),
      )
      .limit(1);
    const before = existing[0];
    if (!before) {
      // Auto-create the row if missing — admins manually allocating before a
      // user has a row for that (year, type).
      await db.insert(leaveBalances).values({
        employeeId: body.employeeId,
        leaveTypeId: body.leaveTypeId,
        year: body.year,
        allocated: body.allocated ?? 0,
        used: body.used ?? 0,
      });
      await writeAuditLog({
        actorId: session.user.id,
        action: "balance.create",
        targetTable: "leave_balances",
        targetId: null,
        metadata: {
          employeeId: body.employeeId,
          leaveTypeId: body.leaveTypeId,
          year: body.year,
          allocated: body.allocated ?? 0,
          used: body.used ?? 0,
          reason: safeReason,
        },
      });
      return NextResponse.json({ created: true });
    }
    await db
      .update(leaveBalances)
      .set({
        ...(body.allocated !== undefined && { allocated: body.allocated }),
        ...(body.used !== undefined && { used: body.used }),
      })
      .where(eq(leaveBalances.id, before.id));
    await writeAuditLog({
      actorId: session.user.id,
      action: "balance.adjust",
      targetTable: "leave_balances",
      targetId: before.id,
      metadata: {
        employeeId: body.employeeId,
        leaveTypeId: body.leaveTypeId,
        year: body.year,
        before: { allocated: before.allocated, used: before.used },
        after: {
          allocated: body.allocated ?? before.allocated,
          used: body.used ?? before.used,
        },
        reason: safeReason,
      },
    });
    return NextResponse.json({ id: before.id, updated: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
