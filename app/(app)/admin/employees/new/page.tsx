import * as React from "react";

import { NoAccess } from "@/components/feedback/no-access";
import { PageShell } from "@/components/layout/page-shell";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { EmployeeForm } from "../employee-form";

export const metadata = {
  title: "Add employee",
};

export default async function NewEmployeePage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  if (!isAdminRole(session.user.role)) return <NoAccess />;
  return (
    <PageShell
      title="Add employee"
      description="Pre-stage a user row. They'll sign in via Google when ready."
      breadcrumbs={
        <a
          href="/admin/employees"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Back to employees
        </a>
      }
    >
      <EmployeeForm mode="create" />
    </PageShell>
  );
}
