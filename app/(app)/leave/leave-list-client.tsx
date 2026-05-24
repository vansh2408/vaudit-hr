"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, PlusCircle } from "lucide-react";

import { DataTable } from "@/components/tables/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { TableSkeleton } from "@/components/feedback/skeletons";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listLeave, queryKeys, type LeaveRequestRow } from "@/lib/api/queries";
import { emptyStates } from "@/lib/copy/empty-states";
import type { RequestStatus } from "@/lib/db/schema";
import { formatYmdRange, unsafeYmd } from "@/lib/utils/dates";
import { formatDays } from "@/lib/utils/format-days";
import { formatInstantDate } from "@/lib/utils/timezone";
import { LeaveRequestDialog } from "./leave-request-dialog";

export interface LeaveTypeLite {
  id: string;
  name: string;
  isPaid: boolean;
}

export interface MyBalanceLite {
  allocated: number;
  used: number;
  year: number;
}

interface Props {
  leaveTypes: LeaveTypeLite[];
  balancesByType: Record<string, MyBalanceLite>;
  currentYear: number;
  holidayDatesYmd: ReadonlyArray<string>;
  /**
   * When set, the list is scoped to that employee (admin viewing
   * someone else's history). The "New request" affordances are hidden
   * — submitting on behalf isn't a flow this page supports. When
   * undefined the list shows the caller's own rows.
   */
  employeeId?: string;
}

const STATUS_OPTIONS: ReadonlyArray<RequestStatus> = [
  "PENDING",
  "APPROVED",
  "PENDING_CANCELLATION",
  "REJECTED",
  "CANCELLED",
];

function formatRange(startYmd: string, endYmd: string): string {
  return formatYmdRange(unsafeYmd(startYmd), unsafeYmd(endYmd));
}

export function LeaveListClient({
  leaveTypes,
  balancesByType,
  currentYear,
  holidayDatesYmd,
  employeeId,
}: Props): React.JSX.Element {
  const params = useSearchParams();
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | RequestStatus>(
    "ALL",
  );
  const [typeFilter, setTypeFilter] = React.useState<"ALL" | string>("ALL");
  const [yearFilter, setYearFilter] = React.useState<number>(currentYear);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // "Admin viewing someone else's history" mode — drives both the API
  // scope and which submit affordances render.
  const isOtherEmployee = employeeId !== undefined;

  React.useEffect(() => {
    // Only the self list honours ?new=1 → open the submit dialog. On the
    // admin embed there's no dialog to open.
    if (!isOtherEmployee && params?.get("new") === "1") {
      setDialogOpen(true);
    }
  }, [params, isOtherEmployee]);

  const apiStatus =
    statusFilter === "ALL" ? undefined : (statusFilter as RequestStatus);

  const { data, isLoading } = useQuery({
    queryKey: isOtherEmployee
      ? queryKeys.leave.list({
          employeeId,
          status: apiStatus,
        })
      : queryKeys.leave.mine(apiStatus),
    queryFn: () =>
      listLeave({
        pageSize: 100,
        ...(apiStatus !== undefined && { status: apiStatus }),
        ...(employeeId !== undefined && { employeeId }),
      }),
  });

  const typeNameById = React.useMemo(
    () => new Map(leaveTypes.map((t) => [t.id, t.name])),
    [leaveTypes],
  );

  const filteredItems = React.useMemo<LeaveRequestRow[]>(() => {
    const items = data?.items ?? [];
    return items.filter((row) => {
      if (typeFilter !== "ALL" && row.leaveTypeId !== typeFilter) return false;
      // startDate is YYYY-MM-DD — extract the year by string slice (TZ-safe).
      if (Number(row.startDate.slice(0, 4)) !== yearFilter) return false;
      return true;
    });
  }, [data?.items, typeFilter, yearFilter]);

  const columns = React.useMemo<ColumnDef<LeaveRequestRow, unknown>[]>(
    () => [
      {
        id: "type",
        header: "Type",
        accessorFn: (row) => typeNameById.get(row.leaveTypeId) ?? "—",
        cell: ({ row }) => (
          <LeaveTypeBadge
            name={typeNameById.get(row.original.leaveTypeId) ?? "—"}
          />
        ),
      },
      {
        id: "dates",
        header: "Dates",
        accessorFn: (row) => row.startDate,
        cell: ({ row }) => (
          <span className="text-sm">
            {formatRange(row.original.startDate, row.original.endDate)}
          </span>
        ),
      },
      {
        id: "totalDays",
        header: "Days",
        accessorFn: (row) => row.totalDays,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDays(row.original.totalDays)}</span>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => row.status,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "reviewedAt",
        header: "Reviewed",
        accessorFn: (row) => row.reviewedById ?? "",
        cell: ({ row }) =>
          row.original.reviewedById ? (
            <span className="text-xs text-muted-foreground">
              {row.original.reviewedAt
                ? formatInstantDate(row.original.reviewedAt)
                : "—"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "submittedAt",
        header: "Submitted",
        accessorFn: (row) => row.createdAt,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatInstantDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Link
            href={`/leave/${row.original.id}`}
            className="text-xs font-medium text-primary hover:underline focus-visible:underline"
            aria-label={`Open leave request ${row.original.id}`}
          >
            View
          </Link>
        ),
      },
    ],
    [typeNameById],
  );

  const years = React.useMemo(() => {
    const now = currentYear;
    return [now - 1, now, now + 1];
  }, [currentYear]);

  const empty = isOtherEmployee ? (
    <EmptyState
      icon={<CalendarDays />}
      title="No leave history"
      description="This employee hasn't submitted any leave requests matching the current filters."
    />
  ) : (
    <EmptyState
      icon={<CalendarDays />}
      title={emptyStates.noLeaveRequests.title}
      description={emptyStates.noLeaveRequests.description}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <PlusCircle className="h-4 w-4" aria-hidden />
          {emptyStates.noLeaveRequests.ctaLabel}
        </Button>
      }
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as "ALL" | RequestStatus)}
            options={[
              { value: "ALL", label: "All statuses" },
              ...STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
            ]}
          />
          <FilterSelect
            label="Type"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v)}
            options={[
              { value: "ALL", label: "All types" },
              ...leaveTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <FilterSelect
            label="Year"
            value={String(yearFilter)}
            onChange={(v) => setYearFilter(Number(v))}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        </div>
        {isOtherEmployee ? null : (
          <Button onClick={() => setDialogOpen(true)}>
            <PlusCircle className="h-4 w-4" aria-hidden />
            New request
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <DataTable
          columns={columns}
          data={filteredItems}
          emptyState={empty}
          filtering={false}
          mobileRender={(row) => (
            <Link
              href={`/leave/${row.id}`}
              className="block rounded-lg border border-border bg-card p-4 transition-ui hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <LeaveTypeBadge
                  name={typeNameById.get(row.leaveTypeId) ?? "—"}
                />
                <StatusBadge status={row.status} />
              </div>
              <p className="mt-2 text-sm">
                {formatRange(row.startDate, row.endDate)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDays(row.totalDays)}
              </p>
            </Link>
          )}
        />
      )}

      {isOtherEmployee ? null : (
        <LeaveRequestDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          leaveTypes={leaveTypes}
          balancesByType={balancesByType}
          currentYear={currentYear}
          holidayDatesYmd={holidayDatesYmd}
        />
      )}
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: FilterSelectProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="h-9 w-36"
          aria-label={`Filter by ${label.toLowerCase()}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
