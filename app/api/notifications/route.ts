/**
 * /api/notifications
 *  GET → own notifications, newest first; supports ?unreadOnly=true + paging
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { notificationsListQuerySchema } from "@/lib/validation/common";
import { handleRouteError } from "@/lib/api/errors";
import { parseSearchParams } from "@/lib/api/route-helpers";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    const q = parseSearchParams(req.url, notificationsListQuerySchema);
    const conds: SQL<unknown>[] = [eq(notifications.employeeId, session.user.id)];
    if (q.unreadOnly) conds.push(eq(notifications.isRead, false));
    const where = and(...conds);
    const offset = (q.page - 1) * q.pageSize;
    const rows = await db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(q.pageSize)
      .offset(offset);
    const unreadRows = await db
      .select({ n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.employeeId, session.user.id),
          eq(notifications.isRead, false),
        ),
      );
    const unreadCount = unreadRows[0]?.n ?? 0;
    return NextResponse.json({
      items: rows,
      page: q.page,
      pageSize: q.pageSize,
      unreadCount,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
