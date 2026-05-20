/**
 * /api/admin/audit-logs
 *  GET → paginated filterable view of audit_logs. Admin-only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLogFilterSchema } from "@/lib/validation/common";
import { handleRouteError } from "@/lib/api/errors";
import { parseSearchParams } from "@/lib/api/route-helpers";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const q = parseSearchParams(req.url, auditLogFilterSchema);
    const conds: SQL<unknown>[] = [];
    if (q.actorId) conds.push(eq(auditLogs.actorId, q.actorId));
    if (q.actorQuery) {
      // Tokenize on whitespace so a query like "vansh na" matches the actor
      // "Vansh Nandwani" — the substring "vansh na" doesn't live inside any
      // single column, but tokens "vansh" and "na" each hit one. Tokens are
      // ANDed (every token must match somewhere); for each token we OR
      // across firstName / lastName / email. Token order is irrelevant, so
      // "nandwani vansh" works too. Empty tokens are filtered after split.
      // pageSize/actorQuery length are bounded by the zod schema, so the
      // worst-case token count is small.
      const tokens = q.actorQuery
        .split(/\s+/)
        .filter((t) => t.length > 0);
      for (const t of tokens) {
        const needle = `%${t}%`;
        const orExpr = or(
          ilike(users.firstName, needle),
          ilike(users.lastName, needle),
          ilike(users.email, needle),
        );
        if (orExpr) conds.push(orExpr);
      }
    }
    if (q.action) conds.push(eq(auditLogs.action, q.action));
    if (q.targetTable) conds.push(eq(auditLogs.targetTable, q.targetTable));
    // Filter dates are calendar-day Ymd strings; createdAt is an instant.
    // Treat the day as starting at UTC midnight — coarse but TZ-stable and
    // sufficient for the admin audit filter UI. (For ORG-TZ-precise filtering
    // we'd build the bounds with Intl, but this is an internal tool.)
    if (q.dateFrom) {
      conds.push(gte(auditLogs.createdAt, new Date(`${q.dateFrom}T00:00:00Z`)));
    }
    if (q.dateTo) {
      conds.push(lte(auditLogs.createdAt, new Date(`${q.dateTo}T23:59:59.999Z`)));
    }
    const where = conds.length > 0 ? and(...conds) : undefined;
    const offset = (q.page - 1) * q.pageSize;
    // leftJoin users — preserves rows whose actor was deleted or where the
    // action was system-issued (actorId IS NULL). Those rows surface with
    // actorName/email = null and the UI renders "System" / "—".
    const rows = await db
      .select({
        id: auditLogs.id,
        actorId: auditLogs.actorId,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
        actorEmail: users.email,
        action: auditLogs.action,
        targetTable: auditLogs.targetTable,
        targetId: auditLogs.targetId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(q.pageSize)
      .offset(offset);
    const items = rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorName:
        r.actorFirstName && r.actorLastName
          ? `${r.actorFirstName} ${r.actorLastName}`
          : null,
      actorEmail: r.actorEmail,
      action: r.action,
      targetTable: r.targetTable,
      targetId: r.targetId,
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
    return NextResponse.json({
      items,
      page: q.page,
      pageSize: q.pageSize,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
