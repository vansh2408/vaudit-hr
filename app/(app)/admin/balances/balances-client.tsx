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
              <SelectValue placeholder="Pick an employee" />
            </SelectTrigger>
            <SelectContent>
              {(employeesQuery.data?.items ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </SelectItem>
              ))}
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
  const [allocated, setAllocated] = React.useState<number>(row.allocated);
  React.useEffect(() => setAllocated(row.allocated), [row.allocated]);

  const dirty = allocated !== row.allocated;
  const remaining = Math.max(allocated - row.used, 0);

  const save = useMutation({
    mutationFn: () =>
      adjustBalance({
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        allocated,
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
          max={366}
          value={allocated}
          onChange={(e) => setAllocated(Number(e.target.value))}
          className="ml-auto h-9 w-24 text-right tabular-nums"
          aria-label={`Allocated days for ${row.leaveTypeName}`}
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.used}</td>
      <td className="px-3 py-2 text-right tabular-nums">{remaining}</td>
      <td className="px-3 py-2 text-right">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </td>
    </tr>
  );
}
