/**
 * /api/admin/employees/[id]/role
 *  PATCH → SUPER_ADMIN only. Audit-logs the role change AND any rejection.
 *
 * Guard rails:
 *  - Last-active-SUPER_ADMIN demotion refused. If the target is a
 *    SUPER_ADMIN and the new role is anything else, we require at least
 *    one other active SUPER_ADMIN to remain. This guard also covers the
 *    self-demote lockout case (counts "OTHER" admins via `ne(id, target)`),
 *    so self-role-change is permitted when the org still has another
 *    SUPER_ADMIN. The UI confirms the destructive step before submission.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { roleUpdateSchema } from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { writeAuditLog } from "@/lib/audit/log";
import { assertSameOrigin } from "@/lib/security/csrf";

interface Ctx {
  params: { id: string };
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireRole("SUPER_ADMIN");
    const body = roleUpdateSchema.parse(await req.json());
    const existing = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, ctx.params.id))
      .limit(1);
    const row = existing[0];
    if (!row) return apiError(404, "NOT_FOUND", "Employee not found");
    if (row.role === body.role) {
      return NextResponse.json({ id: ctx.params.id, role: body.role, changed: false });
    }
    // Last-SUPER_ADMIN demotion guard. We count OTHER active SUPER_ADMINs;
    // if zero remain after this change, refuse. The count + audit reject is
    // deliberately done in a single read so the race window is tiny — the
    // only way to defeat it is two concurrent demotions, which would each
    // see one other admin and both succeed. Acceptable for v1; revisit
    // if/when row-level locking lands.
    if (row.role === "SUPER_ADMIN" && body.role !== "SUPER_ADMIN") {
      const others = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, "SUPER_ADMIN"),
            eq(users.isActive, true),
            ne(users.id, ctx.params.id),
          ),
        )
        .limit(1);
      if (others.length === 0) {
        await writeAuditLog({
          actorId: session.user.id,
          action: "employee.role_change_rejected",
          targetTable: "users",
          targetId: ctx.params.id,
          metadata: {
            reason: "last_super_admin",
            from: row.role,
            to: body.role,
          },
        });
        return apiError(
          409,
          "last_super_admin",
          "Cannot demote the last active SUPER_ADMIN",
        );
      }
    }
    await db.update(users).set({ role: body.role }).where(eq(users.id, ctx.params.id));
    await writeAuditLog({
      actorId: session.user.id,
      action: "employee.role_change",
      targetTable: "users",
      targetId: ctx.params.id,
      metadata: { from: row.role, to: body.role },
    });
    return NextResponse.json({ id: ctx.params.id, role: body.role, changed: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
