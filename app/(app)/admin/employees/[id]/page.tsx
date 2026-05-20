import * as React from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { NoAccess } from "@/components/no-access";
import { PageShell } from "@/components/page-shell";
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
