/**
 * /api/holidays/[id]
 *  DELETE → remove a holiday. HR_ADMIN / SUPER_ADMIN only. Audit-logged.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { writeAuditLog } from "@/lib/audit/log";
import { assertSameOrigin } from "@/lib/security/csrf";

interface Ctx {
  params: { id: string };
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireAdmin();
    const existing = await db
      .select({ id: holidays.id, date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(eq(holidays.id, ctx.params.id))
      .limit(1);
    const row = existing[0];
    if (!row) return apiError(404, "NOT_FOUND", "Holiday not found");
    await db.delete(holidays).where(eq(holidays.id, ctx.params.id));
    await writeAuditLog({
      actorId: session.user.id,
      action: "holiday.delete",
      targetTable: "holidays",
      targetId: ctx.params.id,
      metadata: { date: row.date, name: row.name },
    });
    return NextResponse.json({ id: ctx.params.id, deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
