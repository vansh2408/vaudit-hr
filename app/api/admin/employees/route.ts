/**
 * /api/admin/employees
 *  GET  → list (default active-only; ?includeInactive=true to include all)
 *  POST → create employee with auto-balance creation
 */
import { NextResponse, type NextRequest } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { leaveBalances, leaveTypes, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import {
  employeeCreateSchema,
  employeeListQuerySchema,
} from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { parseSearchParams } from "@/lib/api/route-helpers";
import { detectManagerCycle } from "@/lib/security/cycle-detect";
import { writeAuditLog } from "@/lib/audit/log";
import { assertSameOrigin } from "@/lib/security/csrf";
import { sanitizeFreeText } from "@/lib/security/sanitize";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const q = parseSearchParams(req.url, employeeListQuerySchema);
    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        position: users.position,
        department: users.department,
        role: users.role,
        managerId: users.managerId,
        slackUserId: users.slackUserId,
        startDate: users.startDate,
        birthday: users.birthday,
        isActive: users.isActive,
      })
      .from(users)
      .where(q.includeInactive ? undefined : eq(users.isActive, true))
      .orderBy(asc(users.firstName));
    return NextResponse.json({ items: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireAdmin();
    const body = employeeCreateSchema.parse(await req.json());
    // Privilege-escalation guard: HR_ADMIN must NOT be able to mint a new
    // SUPER_ADMIN at create time — that would bypass the SUPER_ADMIN-only
    // /role PATCH endpoint. Only an existing SUPER_ADMIN may assign the
    // SUPER_ADMIN role on creation.
    if (body.role === "SUPER_ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return apiError(
        403,
        "CANNOT_GRANT_SUPER_ADMIN",
        "Only a SUPER_ADMIN may create another SUPER_ADMIN",
      );
    }
    // Sanitise every free-text field on the way in. Drizzle's parameterised
    // insert handles SQL injection; sanitizeFreeText defends downstream
    // sinks (Slack DMs, exports) from stored XSS.
    const safe = {
      firstName: sanitizeFreeText(body.firstName),
      lastName: sanitizeFreeText(body.lastName),
      address: body.address !== undefined ? sanitizeFreeText(body.address) : undefined,
      position: body.position !== undefined ? sanitizeFreeText(body.position) : undefined,
      department: body.department !== undefined ? sanitizeFreeText(body.department) : undefined,
      // phone/slackUserId are length-checked but not regex-validated, so a
      // crafted string with markup would otherwise reach Slack message
      // bodies / CSV exports unescaped.
      phone: body.phone !== undefined ? sanitizeFreeText(body.phone) : undefined,
      slackUserId:
        body.slackUserId !== undefined ? sanitizeFreeText(body.slackUserId) : undefined,
    };
    // Email uniqueness check first (clearer than relying on DB constraint).
    const dupe = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (dupe.length > 0) return apiError(409, "DUPLICATE_EMAIL", "Email already in use");
    if (body.managerId) {
      // Pull the live manager graph once and run the pure cycle detector
      // with employeeId=undefined (this row doesn't exist yet, so the only
      // failure modes are a pre-existing cycle / missing proposed manager).
      // Replaces the old DB-walker that took a placeholder sentinel id and
      // could silently miss real cycles — see docs/reviews/wave-1-backend.md F7.
      const relations = await db
        .select({ id: users.id, managerId: users.managerId })
        .from(users);
      if (detectManagerCycle(undefined, body.managerId, relations)) {
        return apiError(400, "MANAGER_CYCLE", "Manager chain would create a cycle");
      }
    }
    const newId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: newId,
        email: body.email,
        name: `${safe.firstName} ${safe.lastName}`,
        firstName: safe.firstName,
        lastName: safe.lastName,
        ...(safe.phone !== undefined && { phone: safe.phone }),
        ...(safe.address !== undefined && { address: safe.address }),
        ...(safe.position !== undefined && { position: safe.position }),
        ...(safe.department !== undefined && { department: safe.department }),
        ...(body.startDate !== undefined && { startDate: body.startDate }),
        ...(body.birthday !== undefined && { birthday: body.birthday }),
        role: body.role,
        ...(body.managerId !== undefined && { managerId: body.managerId }),
        ...(safe.slackUserId !== undefined && { slackUserId: safe.slackUserId }),
        isActive: true,
      });
      const year = new Date().getFullYear();
      const activeTypes = await tx
        .select({ id: leaveTypes.id, defaultBalance: leaveTypes.defaultBalance })
        .from(leaveTypes)
        .where(inArray(leaveTypes.isActive, [true]));
      for (const t of activeTypes) {
        await tx
          .insert(leaveBalances)
          .values({
            employeeId: newId,
            leaveTypeId: t.id,
            year,
            allocated: t.defaultBalance,
            used: 0,
          })
          .onConflictDoNothing();
      }
    });
    await writeAuditLog({
      actorId: session.user.id,
      action: "employee.create",
      targetTable: "users",
      targetId: newId,
      metadata: { email: body.email, role: body.role },
    });
    return NextResponse.json({ id: newId }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
