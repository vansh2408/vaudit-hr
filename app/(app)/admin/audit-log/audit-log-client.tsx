"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";

import { DatePicker } from "@/components/date-picker";
import { EmptyState } from "@/components/empty-state";
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
import {
  listAuditLogs,
  queryKeys,
  type AuditLogRow,
} from "@/lib/api/queries";
import { emptyStates } from "@/lib/copy/empty-states";

const PAGE_SIZE = 50;

const KNOWN_ACTIONS = [
  "auth.first_link",
  "employee.create",
  "employee.update",
  "employee.deactivate",
  "employee.role_change",
  "employee.import_dryrun",
  "employee.import_commit",
  "balance.create",
  "balance.adjust",
  "leave.create",
  "leave.approve",
  "leave.reject",
  "leave.cancel_pending",
  "leave.cancel_approved",
  "wfh.create",
  "wfh.approve",
  "wfh.reject",
  "wfh.cancel_pending",
  "wfh.cancel_approved",
  "holiday.create",
  "holiday.delete",
] as const;

const KNOWN_TABLES = [
  "users",
  "leave_requests",
  "wfh_requests",
  "leave_balances",
  "holidays",
] as const;

interface Filters {
  /**
   * Free-text query that the server matches against first name, last name,
   * or email (case-insensitive substring). Replaces the previous "Actor ID"
   * UUID input — operators don't recognize actors by UUID.
   */
  actorQuery?: string;
  action?: string;
  targetTable?: string;
  dateFrom?: string;
  dateTo?: string;
}

// createdAt is an instant (PG timestamp), displayed in the org TZ.
import { formatInstant } from "@/lib/utils/timezone";
function fmt(iso: string): string {
  return formatInstant(iso);
}

function metadataPreview(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return "—";
  try {
    return JSON.stringify(metadata);
  } catch {
    return "—";
  }
}

// Delay between the last keystroke and the request firing. Long enough to
// skip the request for typing bursts ("vansh na" sends one query instead of
// seven), short enough to feel live.
const ACTOR_QUERY_DEBOUNCE_MS = 250;

export function AuditLogClient(): React.JSX.Element {
  const [filters, setFilters] = React.useState<Filters>({});
  const [page, setPage] = React.useState<number>(1);

  // Local mirror of the Actor input. The user sees their keystrokes
  // immediately (this state updates on every change), but `filters.actorQuery`
  // — which drives the React Query refetch — only updates after the debounce
  // expires. Other filters (action / table / dates) are coarse-grained
  // selects and don't need debouncing.
  const [actorInput, setActorInput] = React.useState<string>("");
  React.useEffect(() => {
    const trimmed = actorInput.trim();
    const next = trimmed.length > 0 ? trimmed : undefined;
    const timer = setTimeout(() => {
      setFilters((prev) => {
        if (prev.actorQuery === next) return prev;
        // exactOptionalPropertyTypes: omit the key rather than assigning
        // `undefined`. Strip it on prev first, then add it back only if a
        // value is present.
        const { actorQuery: _omit, ...rest } = prev;
        void _omit;
        return next === undefined ? rest : { ...rest, actorQuery: next };
      });
      // Reset to first page whenever the filter actually changes — same
      // semantics as the synchronous filters via `update()` below.
      setPage((p) => (filters.actorQuery === next ? p : 1));
    }, ACTOR_QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // We intentionally read `filters.actorQuery` inside the callback rather
    // than depending on it: depending on it would reset the timer every
    // time the filter committed, which defeats the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorInput]);

  const queryParams = React.useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(filters.actorQuery ? { actorQuery: filters.actorQuery } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.targetTable ? { targetTable: filters.targetTable } : {}),
      ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
      ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    }),
    [filters, page],
  );

  const filterKey = React.useMemo<Record<string, string | undefined>>(
    () => ({
      page: String(page),
      actorQuery: filters.actorQuery,
      action: filters.action,
      targetTable: filters.targetTable,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    }),
    [filters, page],
  );

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.audit.list(filterKey),
    queryFn: () => listAuditLogs(queryParams),
  });

  function update<K extends keyof Filters>(key: K, value: Filters[K]): void {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value || undefined }));
  }

  const items: AuditLogRow[] = data?.items ?? [];

  return (
    <div className="space-y-4">
      <aside
        aria-label="Filters"
        className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="space-y-1">
          <Label htmlFor="actor">Actor</Label>
          <Input
            id="actor"
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            placeholder="Name or email"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="action">Action</Label>
          <Select
            value={filters.action ?? "__all__"}
            onValueChange={(v) => update("action", v === "__all__" ? "" : v)}
          >
            <SelectTrigger id="action" aria-label="Action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All actions</SelectItem>
              {KNOWN_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="table">Target table</Label>
          <Select
            value={filters.targetTable ?? "__all__"}
            onValueChange={(v) =>
              update("targetTable", v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger id="table" aria-label="Target table">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All tables</SelectItem>
              {KNOWN_TABLES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <DatePicker
            id="from"
            value={filters.dateFrom ?? undefined}
            onChange={(v) => update("dateFrom", v ?? "")}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">To</Label>
          <DatePicker
            id="to"
            value={filters.dateTo ?? undefined}
            onChange={(v) => update("dateTo", v ?? "")}
          />
        </div>
      </aside>

      {isLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={emptyStates.noAuditLogs.title}
          description={emptyStates.noAuditLogs.description}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Actor</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Target</th>
                <th className="px-3 py-2 text-left">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {fmt(row.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.actorName ? (
                      <div>
                        <p className="font-medium text-foreground">
                          {row.actorName}
                        </p>
                        {row.actorEmail ? (
                          <p className="text-muted-foreground">
                            {row.actorEmail}
                          </p>
                        ) : null}
                      </div>
                    ) : row.actorId ? (
                      // Actor row was deleted but the audit FK kept the UUID.
                      // Surface it explicitly so the action is still attributable.
                      <span
                        className="font-mono text-muted-foreground"
                        title={row.actorId}
                      >
                        (deleted user)
                      </span>
                    ) : (
                      // No actor at all — system-issued (cron, automated job).
                      <span className="text-muted-foreground">System</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">{row.action}</td>
                  <td className="px-3 py-2 text-xs">
                    <p>{row.targetTable}</p>
                    <p className="text-muted-foreground">
                      {row.targetId ?? "—"}
                    </p>
                  </td>
                  <td className="max-w-md truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                    {metadataPreview(row.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {page}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={items.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
