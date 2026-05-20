/**
 * /api/notifications/read
 *  POST → mark a single notification or all as read. Owner-only.
 *         Body: { id: string } | { all: true }
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { notificationReadSchema } from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireSession();
    const body = notificationReadSchema.parse(await req.json());
    if (body.all) {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.employeeId, session.user.id),
            eq(notifications.isRead, false),
          ),
        );
      return NextResponse.json({ updated: "all" });
    }
    if (!body.id) {
      return apiError(400, "VALIDATION_ERROR", "Provide id or all:true");
    }
    const existing = await db
      .select({ id: notifications.id, employeeId: notifications.employeeId })
      .from(notifications)
      .where(eq(notifications.id, body.id))
      .limit(1);
    const row = existing[0];
    if (!row) return apiError(404, "NOT_FOUND", "Notification not found");
    if (row.employeeId !== session.user.id) {
      return apiError(403, "FORBIDDEN", "Not your notification");
    }
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, body.id));
    return NextResponse.json({ id: body.id, updated: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
