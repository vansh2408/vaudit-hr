/**
 * /api/org-chart
 *  GET → returns the org tree built from active users.
 *
 * Open to any signed-in user — the chart only exposes name, position,
 * department, avatar and the manager hierarchy, none of which is sensitive
 * (salary / contact info live behind /admin/employees). Inactive users are
 * excluded so the chart only shows the current org.
 */
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { handleRouteError } from "@/lib/api/errors";
import { buildTree } from "@/lib/orgchart/tree";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        position: users.position,
        department: users.department,
        image: users.image,
        managerId: users.managerId,
      })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.firstName));
    const roots = buildTree(rows);
    return NextResponse.json({ roots });
  } catch (err) {
    return handleRouteError(err);
  }
}
