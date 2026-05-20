import * as React from "react";
import Link from "next/link";
import { Upload, UserPlus } from "lucide-react";

import { NoAccess } from "@/components/no-access";
import { PageShell } from "@/components/page-shell";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { EmployeesListClient } from "./employees-list-client";

export const metadata = {
  title: "Employees",
};

export default async function EmployeesPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  if (!isAdminRole(session.user.role)) return <NoAccess />;
  return (
    <PageShell
      title="Employees"
      description="Add, edit, deactivate, and manage roles for everyone in the org."
      actions={
        <>
          <Button asChild variant="outline">
            <Link href="/admin/employees/import">
              <Upload className="h-4 w-4" aria-hidden />
              Import CSV
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/employees/new">
              <UserPlus className="h-4 w-4" aria-hidden />
              Add employee
            </Link>
          </Button>
        </>
      }
    >
      <React.Suspense fallback={<TableSkeleton rows={8} cols={5} />}>
        <EmployeesListClient />
      </React.Suspense>
    </PageShell>
  );
}
