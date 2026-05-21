"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Laptop, PlusCircle } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listWfh, queryKeys, type WfhRequestRow } from "@/lib/api/queries";
import type { RequestStatus } from "@/lib/db/schema";
import { formatYmdRange, unsafeYmd } from "@/lib/utils/dates";
import { formatDays } from "@/lib/utils/format-days";
import { formatInstantDate } from "@/lib/utils/timezone";
import { WfhRequestDialog } from "./wfh-request-dialog";

const STATUS_OPTIONS: ReadonlyArray<RequestStatus> = [
  "PENDING",
  "APPROVED",
  "PENDING_CANCELLATION",
  "REJECTED",
  "CANCELLED",
];

function fmtRange(startYmd: string, endYmd: string): string {
  return formatYmdRange(unsafeYmd(startYmd), unsafeYmd(endYmd));
}

interface WfhListClientProps {
  holidayDatesYmd: ReadonlyArray<string>;
  /**
   * When set, the list is scoped to that employee (admin viewing
   * someone else's history). Submit affordances are hidden. When
   * undefined the list shows the caller's own rows.
   */
  employeeId?: string;
}

export function WfhListClient({
  holidayDatesYmd,
  employeeId,
}: WfhListClientProps): React.JSX.Element {
  const params = useSearchParams();
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | RequestStatus>(
    "ALL",
  );
  const [yearFilter, setYearFilter] = React.useState<number>(
    new Date().getFullYear(),
  );
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const isOtherEmployee = employeeId !== undefined;

  React.useEffect(() => {
    if (!isOtherEmployee && params?.get("new") === "1") {
      setDialogOpen(true);
    }
  }, [params, isOtherEmployee]);

  const apiStatus =
    statusFilter === "ALL" ? undefined : (statusFilter as RequestStatus);
  const { data, isLoading } = useQuery({
    queryKey: isOtherEmployee
      ? queryKeys.wfh.list({
          employeeId,
          status: apiStatus,
        })
      : queryKeys.wfh.mine(apiStatus),
    queryFn: () =>
      listWfh({
        pageSize: 100,
        ...(apiStatus !== undefined && { status: apiStatus }),
        ...(employeeId !== undefined && { employeeId }),
      }),
  });

  const filtered = React.useMemo<WfhRequestRow[]>(() => {
    const items = data?.items ?? [];
    // startDate is YYYY-MM-DD; first 4 chars are the year. Avoid Date parsing
    // entirely so the filter is TZ-agnostic.
    return items.filter((row) => Number(row.startDate.slice(0, 4)) === yearFilter);
  }, [data?.items, yearFilter]);

  const columns = React.useMemo<ColumnDef<WfhRequestRow, unknown>[]>(
    () => [
      {
        id: "dates",
        header: "Dates",
        accessorFn: (row) => row.startDate,
        cell: ({ row }) => (
          <span className="text-sm">
            {fmtRange(row.original.startDate, row.original.endDate)}
          </span>
        ),
      },
      {
        id: "days",
        header: "Days",
        accessorFn: (row) => row.totalDays,
        cell: ({ row }) => (
          <span className="text-xs tabular-nums">{formatDays(row.original.totalDays)}</span>
        ),
      },
      {
        id: "reason",
        header: "Reason",
        accessorFn: (row) => row.reason ?? "",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.reason ?? "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => row.status,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
            href={`/wfh/${row.original.id}`}
            className="text-xs font-medium text-primary hover:underline focus-visible:underline"
            aria-label={`Open WFH request ${row.original.id}`}
          >
            View
          </Link>
        ),
      },
    ],
    [],
  );

  const years = React.useMemo(() => {
    const now = new Date().getFullYear();
    return [now - 1, now, now + 1];
  }, []);

  const empty = isOtherEmployee ? (
    <EmptyState
      icon={<Laptop />}
      title="No WFH history"
      description="This employee hasn't submitted any WFH requests matching the current filters."
    />
  ) : (
    <EmptyState
      icon={<Laptop />}
      title="No WFH requests yet"
      description="When you submit a WFH day, it'll appear here."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <PlusCircle className="h-4 w-4" aria-hidden />
          New WFH request
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
            label="Year"
            value={String(yearFilter)}
            onChange={(v) => setYearFilter(Number(v))}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        </div>
        {isOtherEmployee ? null : (
          <Button onClick={() => setDialogOpen(true)}>
            <PlusCircle className="h-4 w-4" aria-hidden />
            New WFH request
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          emptyState={empty}
          filtering={false}
          mobileRender={(row) => (
            <Link
              href={`/wfh/${row.id}`}
              className="block rounded-lg border border-border bg-card p-4 transition-ui hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {fmtRange(row.startDate, row.endDate)}
                </span>
                <StatusBadge status={row.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDays(row.totalDays)}
              </p>
              {row.reason ? (
                <p className="mt-2 text-xs text-muted-foreground">{row.reason}</p>
              ) : null}
            </Link>
          )}
        />
      )}

      {isOtherEmployee ? null : (
        <WfhRequestDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
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
