/**
 * /api/admin/employees/[id]
 *  GET    → fetch one
 *  PATCH  → update (with manager-cycle detection per A10)
 *  DELETE → soft-delete (deactivate + auto-cancel PENDING per A9)
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { employeeUpdateSchema } from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { detectManagerCycle } from "@/lib/security/cycle-detect";
import { writeAuditLog } from "@/lib/audit/log";
import { deactivateEmployee, LastSuperAdminError } from "@/lib/employee/deactivate";
import { assertSameOrigin } from "@/lib/security/csrf";
import { sanitizeFreeText } from "@/lib/security/sanitize";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    await requireAdmin();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.params.id))
      .limit(1);
    const row = rows[0];
    if (!row) return apiError(404, "NOT_FOUND", "Employee not found");
    return NextResponse.json({ item: row });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireAdmin();
    const body = employeeUpdateSchema.parse(await req.json());
    // Sanitise free-text fields after Zod validation, before DB write. The
    // schema is also our mass-assignment whitelist — it omits `role` and
    // `email`; role mutation lives at /role/route.ts (SUPER_ADMIN only).
    const safe = {
      firstName: body.firstName !== undefined ? sanitizeFreeText(body.firstName) : undefined,
      lastName: body.lastName !== undefined ? sanitizeFreeText(body.lastName) : undefined,
      address:
        body.address === null
          ? null
          : body.address !== undefined
            ? sanitizeFreeText(body.address)
            : undefined,
      position:
        body.position === null
          ? null
          : body.position !== undefined
            ? sanitizeFreeText(body.position)
            : undefined,
      department:
        body.department === null
          ? null
          : body.department !== undefined
            ? sanitizeFreeText(body.department)
            : undefined,
      // phone/slackUserId are length-checked but not regex-validated, so
      // crafted markup could otherwise reach Slack DMs / CSV exports
      // unescaped. Null = explicit clear, undefined = leave unchanged.
      phone:
        body.phone === null
          ? null
          : body.phone !== undefined
            ? sanitizeFreeText(body.phone)
            : undefined,
      slackUserId:
        body.slackUserId === null
          ? null
          : body.slackUserId !== undefined
            ? sanitizeFreeText(body.slackUserId)
            : undefined,
    };
    const existing = await db
      .select({ id: users.id, managerId: users.managerId })
      .from(users)
      .where(eq(users.id, ctx.params.id))
      .limit(1);
    if (existing.length === 0) return apiError(404, "NOT_FOUND", "Employee not found");
    // Self-mutation guard on managerId. An admin shouldn't be able to
    // reassign their OWN manager — that would let them point at a
    // subordinate and distort approval flows. Cycle detector catches
    // direct loops; this catches the broader "self-attached subgraph"
    // case where the new manager has no cycle but is socially wrong.
    // Same two-person principle as CANNOT_SELF_DEMOTE / balance.
    if (
      ctx.params.id === session.user.id &&
      body.managerId !== undefined &&
      body.managerId !== existing[0]?.managerId
    ) {
      return apiError(
        403,
        "CANNOT_SELF_EDIT_MANAGER",
        "You cannot change your own manager — ask another admin",
      );
    }
    if (body.managerId !== undefined && body.managerId !== null) {
      // Pull the live manager graph once and run the pure cycle detector.
      // We pass the existing user's id so a chain looping back to it via
      // any ancestor is detected. The detector also catches pre-existing
      // cycles via its visited-set guard.
      const relations = await db
        .select({ id: users.id, managerId: users.managerId })
        .from(users);
      if (detectManagerCycle(ctx.params.id, body.managerId, relations)) {
        return apiError(400, "MANAGER_CYCLE", "Manager chain would create a cycle");
      }
    }
    const nameUpdate =
      safe.firstName !== undefined || safe.lastName !== undefined
        ? await (async () => {
            const current = await db
              .select({ firstName: users.firstName, lastName: users.lastName })
              .from(users)
              .where(eq(users.id, ctx.params.id))
              .limit(1);
            const first = safe.firstName ?? current[0]?.firstName ?? "";
            const last = safe.lastName ?? current[0]?.lastName ?? "";
            return { name: `${first} ${last}` };
          })()
        : {};
    await db
      .update(users)
      .set({
        ...(safe.firstName !== undefined && { firstName: safe.firstName }),
        ...(safe.lastName !== undefined && { lastName: safe.lastName }),
        ...nameUpdate,
        ...(safe.phone !== undefined && { phone: safe.phone }),
        ...(safe.address !== undefined && { address: safe.address }),
        ...(safe.position !== undefined && { position: safe.position }),
        ...(safe.department !== undefined && { department: safe.department }),
        ...(body.startDate !== undefined && { startDate: body.startDate }),
        ...(body.birthday !== undefined && { birthday: body.birthday }),
        ...(body.managerId !== undefined && { managerId: body.managerId }),
        ...(safe.slackUserId !== undefined && { slackUserId: safe.slackUserId }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      })
      .where(eq(users.id, ctx.params.id));
    await writeAuditLog({
      actorId: session.user.id,
      action: "employee.update",
      targetTable: "users",
      targetId: ctx.params.id,
      metadata: { fields: Object.keys(body) },
    });
    return NextResponse.json({ id: ctx.params.id });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireAdmin();
    if (session.user.id === ctx.params.id) {
      return apiError(400, "CANNOT_SELF_DEACTIVATE", "Cannot deactivate yourself");
    }
    try {
      const result = await deactivateEmployee(ctx.params.id, session.user.id);
      return NextResponse.json(result);
    } catch (e) {
      if (e instanceof LastSuperAdminError) {
        // Audit-log the rejection alongside the role-change last-SUPER_ADMIN
        // guard for forensic symmetry.
        await writeAuditLog({
          actorId: session.user.id,
          action: "employee.deactivate_rejected",
          targetTable: "users",
          targetId: ctx.params.id,
          metadata: { reason: "last_super_admin" },
        });
        return apiError(
          409,
          "last_super_admin",
          "Cannot deactivate the last active SUPER_ADMIN",
        );
      }
      throw e;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
