"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";

import { Avatar } from "@/components/domain/avatar";
import { DataTable } from "@/components/tables/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { RoleBadge } from "@/components/domain/role-badge";
import { TableSkeleton } from "@/components/feedback/skeletons";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  listEmployees,
  queryKeys,
  type EmployeeListRow,
} from "@/lib/api/queries";
import { emptyStates } from "@/lib/copy/empty-states";

export function EmployeesListClient(): React.JSX.Element {
  const [includeInactive, setIncludeInactive] = React.useState(false);
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.employees.list(includeInactive),
    queryFn: () => listEmployees({ includeInactive }),
  });

  const columns = React.useMemo<ColumnDef<EmployeeListRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        accessorFn: (row) => `${row.firstName} ${row.lastName}`,
        cell: ({ row }) => {
          const name = `${row.original.firstName} ${row.original.lastName}`;
          return (
            <Link
              href={`/admin/employees/${row.original.id}`}
              className="flex items-center gap-3 hover:underline"
            >
              <Avatar name={name} size="sm" />
              <div>
                <p className="font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.original.email}
                </p>
              </div>
            </Link>
          );
        },
      },
      {
        id: "position",
        header: "Position",
        accessorFn: (row) => row.position ?? "",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.position ?? "—"}</span>
        ),
      },
      {
        id: "department",
        header: "Department",
        accessorFn: (row) => row.department ?? "",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.department ?? "—"}
          </span>
        ),
      },
      {
        id: "role",
        header: "Role",
        accessorFn: (row) => row.role,
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
      },
      {
        id: "active",
        header: "Status",
        accessorFn: (row) => (row.isActive ? "Active" : "Inactive"),
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
            >
              Active
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Inactive
            </Badge>
          ),
      },
    ],
    [],
  );

  const empty = (
    <EmptyState
      icon={<Users />}
      title={emptyStates.noEmployees.title}
      description={emptyStates.noEmployees.description}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
            aria-label="Include inactive employees"
          />
          Show inactive
        </label>
      </div>
      {isLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          emptyState={empty}
          filtering={{ placeholder: "Search by name, email, or role…" }}
        />
      )}
    </div>
  );
}
