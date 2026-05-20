/**
 * /api/holidays
 *  GET  → list holidays (optionally filter by ?year). Any signed-in user;
 *         holidays are public reference data within the org.
 *  POST → add a holiday (date unique). HR_ADMIN / SUPER_ADMIN only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, asc, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { requireAdmin, requireSession } from "@/lib/auth/guards";
import {
  holidayCreateSchema,
  holidayListQuerySchema,
} from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { parseSearchParams } from "@/lib/api/route-helpers";
import { writeAuditLog } from "@/lib/audit/log";
import { assertSameOrigin } from "@/lib/security/csrf";
import { sanitizeFreeText } from "@/lib/security/sanitize";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession();
    const q = parseSearchParams(req.url, holidayListQuerySchema);
    const where = q.year !== undefined
      ? and(
          gte(holidays.date, `${q.year}-01-01`),
          lte(holidays.date, `${q.year}-12-31`),
        )
      : undefined;
    const rows = await db
      .select()
      .from(holidays)
      .where(where)
      .orderBy(asc(holidays.date));
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
    const body = holidayCreateSchema.parse(await req.json());
    const safeName = sanitizeFreeText(body.name);
    try {
      const inserted = await db
        .insert(holidays)
        .values({ date: body.date, name: safeName })
        .returning({ id: holidays.id });
      const row = inserted[0];
      if (!row) return apiError(500, "INSERT_FAILED", "Insert returned no row");
      await writeAuditLog({
        actorId: session.user.id,
        action: "holiday.create",
        targetTable: "holidays",
        targetId: row.id,
        metadata: { date: body.date, name: safeName },
      });
      return NextResponse.json({ id: row.id }, { status: 201 });
    } catch (e) {
      if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
        return apiError(409, "DUPLICATE_HOLIDAY", "A holiday already exists on that date");
      }
      throw e;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
