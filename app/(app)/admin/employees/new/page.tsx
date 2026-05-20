import * as React from "react";

import { PageShell } from "@/components/page-shell";
import { requireAdmin } from "@/lib/auth/guards";
import { EmployeeForm } from "../employee-form";

export const metadata = {
  title: "Add employee",
};

export default async function NewEmployeePage(): Promise<React.JSX.Element> {
  await requireAdmin();
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
