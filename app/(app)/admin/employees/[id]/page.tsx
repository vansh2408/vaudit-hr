import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";

import { NoAccess } from "@/components/feedback/no-access";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { EmployeeEditView } from "./employee-edit-view";

export const metadata = {
  title: "Edit employee",
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

// startDate is already a YYYY-MM-DD string (Drizzle date mode: "string");
// pass through with a null-coalesce.
function ymdOrEmpty(s: string | null): string {
  return s ?? "";
}

export default async function EditEmployeePage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const session = await requireSession();
  if (!isAdminRole(session.user.role)) return <NoAccess />;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, params.id))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  const canChangeRole = session.user.role === "SUPER_ADMIN";
  const isSelf = session.user.id === row.id;

  return (
    <PageShell
      title={`${row.firstName} ${row.lastName}`}
      description={row.email}
      breadcrumbs={
        <a
          href="/admin/employees"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Back to employees
        </a>
      }
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/team/${row.id}`}>
            View leave &amp; WFH activity
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      }
    >
      <EmployeeEditView
        id={row.id}
        canChangeRole={canChangeRole}
        isSelf={isSelf}
        isActive={row.isActive}
        initial={{
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone ?? "",
          address: row.address ?? "",
          position: row.position ?? "",
          department: row.department ?? "",
          startDate: ymdOrEmpty(row.startDate),
          birthday: row.birthday ?? "",
          role: row.role,
          managerId: row.managerId ?? "",
          slackUserId: row.slackUserId ?? "",
          isActive: row.isActive,
        }}
      />
    </PageShell>
  );
}
