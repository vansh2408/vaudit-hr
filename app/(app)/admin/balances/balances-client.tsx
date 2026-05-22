"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { LeaveTypeBadge } from "@/components/leave-type-badge";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/client";
import {
  adjustBalance,
  listBalances,
  listEmployees,
  queryKeys,
  type BalanceRow,
} from "@/lib/api/queries";
import { formatDays } from "@/lib/utils/format-days";

// DB rows store day-counts as HALF-DAY UNITS (post-0006): 2 = 1 day, 1 = ½ day.
// The admin UI edits in DAYS (with 0.5 step) so users see familiar numbers; we
// convert at the edge — on render in, on save out.
function halvesToDays(halves: number): number {
  return halves / 2;
}
function daysToHalves(days: number): number {
  return Math.round(days * 2);
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

export function BalancesClient(): React.JSX.Element {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [year, setYear] = React.useState<number>(CURRENT_YEAR);

  const employeesQuery = useQuery({
    queryKey: queryKeys.employees.list(false),
    queryFn: () => listEmployees({ includeInactive: false }),
  });

  const balancesQuery = useQuery({
    queryKey: queryKeys.balance.list(employeeId || undefined, year),
    queryFn: () =>
      listBalances({
        year,
        ...(employeeId ? { employeeId } : {}),
      }),
    enabled: Boolean(employeeId),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="employee">Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger id="employee" aria-label="Employee">
              <SelectValue
                placeholder={
                  employeesQuery.isLoading
                    ? "Loading employees…"
                    : "Pick an employee"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {employeesQuery.isLoading ? (
                // Non-SelectItem placeholders inside SelectContent — they're
                // not focusable / selectable, just informational while the
                // query resolves. The trigger placeholder also swaps so
                // there's a visual cue before the dropdown is opened.
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  Loading employees…
                </div>
              ) : employeesQuery.isError ? (
                <div className="px-2 py-1.5 text-sm text-destructive">
                  Couldn&apos;t load employees. Try again in a moment.
                </div>
              ) : (employeesQuery.data?.items ?? []).length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No active employees
                </div>
              ) : (
                (employeesQuery.data?.items ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="year">Year</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger id="year" aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Each change is written to the audit log with before / after values.
      </div>

      {!employeeId ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Pick an employee to see their balances.
        </p>
      ) : balancesQuery.isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : (
        <BalanceTable
          rows={balancesQuery.data?.items ?? []}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["balances"] });
          }}
        />
      )}
    </div>
  );
}

function BalanceTable({
  rows,
  onSaved,
}: {
  rows: BalanceRow[];
  onSaved: () => void;
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No balances for this year.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-right">Allocated</th>
            <th className="px-3 py-2 text-right">Used</th>
            <th className="px-3 py-2 text-right">Remaining</th>
            <th className="px-3 py-2 text-right">Save</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <BalanceRowEditor key={row.id} row={row} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceRowEditor({
  row,
  onSaved,
}: {
  row: BalanceRow;
  onSaved: () => void;
}): React.JSX.Element {
  // Both fields are editable. Edit in days; the row's stored values are in
  // half-day units. Remaining is derived and stays read-only — admins
  // adjust it implicitly by editing allocated or used.
  const [allocatedDays, setAllocatedDays] = React.useState<number>(
    halvesToDays(row.allocated),
  );
  const [usedDays, setUsedDays] = React.useState<number>(halvesToDays(row.used));
  React.useEffect(
    () => setAllocatedDays(halvesToDays(row.allocated)),
    [row.allocated],
  );
  React.useEffect(() => setUsedDays(halvesToDays(row.used)), [row.used]);

  const allocatedHalves = daysToHalves(allocatedDays);
  const usedHalves = daysToHalves(usedDays);
  const allocatedDirty = allocatedHalves !== row.allocated;
  const usedDirty = usedHalves !== row.used;
  const dirty = allocatedDirty || usedDirty;
  // Used must never exceed allocated — block the save and surface a
  // visible signal. Server enforces the same rule (defence-in-depth).
  const usedExceedsAllocated = usedHalves > allocatedHalves;
  const overHalves = usedHalves - allocatedHalves;
  const remainingHalves = Math.max(allocatedHalves - usedHalves, 0);

  const save = useMutation({
    mutationFn: () =>
      adjustBalance({
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        // Only send fields that changed — the API audit-logs before/after
        // for each, so omitted fields don't pollute the log entry.
        ...(allocatedDirty && { allocated: allocatedHalves }),
        ...(usedDirty && { used: usedHalves }),
      }),
    onSuccess: () => {
      toast.success(`${row.leaveTypeName} balance updated`);
      onSaved();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    },
  });

  return (
    <tr>
      <td className="px-3 py-2">
        <LeaveTypeBadge name={row.leaveTypeName} />
      </td>
      <td className="px-3 py-2 text-right">
        <Input
          type="number"
          min={0}
          max={183}
          step={0.5}
          value={allocatedDays}
          onChange={(e) =>
            setAllocatedDays(e.target.value === "" ? 0 : Number(e.target.value))
          }
          className="ml-auto h-9 w-24 text-right tabular-nums"
          aria-label={`Allocated days for ${row.leaveTypeName}`}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <Input
          type="number"
          min={0}
          max={183}
          step={0.5}
          value={usedDays}
          onChange={(e) =>
            setUsedDays(e.target.value === "" ? 0 : Number(e.target.value))
          }
          aria-invalid={usedExceedsAllocated}
          aria-describedby={
            usedExceedsAllocated ? `${row.id}-over` : undefined
          }
          className={`ml-auto h-9 w-24 text-right tabular-nums ${
            usedExceedsAllocated
              ? "border-destructive focus-visible:ring-destructive"
              : ""
          }`}
          aria-label={`Used days for ${row.leaveTypeName}`}
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {usedExceedsAllocated ? (
          <span id={`${row.id}-over`} className="text-destructive">
            {formatDays(overHalves)} over
          </span>
        ) : (
          formatDays(remainingHalves)
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || usedExceedsAllocated || save.isPending}
          title={
            usedExceedsAllocated ? "Used cannot exceed allocated" : undefined
          }
          onClick={() => save.mutate()}
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </td>
    </tr>
  );
}
