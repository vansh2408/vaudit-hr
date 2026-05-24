"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Avatar } from "@/components/domain/avatar";
import { EmptyState } from "@/components/feedback/empty-state";
import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { reviewLeave, reviewWfh } from "@/lib/api/queries";
import { emptyStates } from "@/lib/copy/empty-states";
import type { RequestStatus } from "@/lib/db/schema";
import { formatYmdRange, unsafeYmd } from "@/lib/utils/dates";
import { formatDays } from "@/lib/utils/format-days";
import { formatInstant, formatRelative } from "@/lib/utils/timezone";
import { ClipboardCheck } from "lucide-react";

export interface PendingLeaveRow {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string | null;
  /**
   * "PENDING" → a new request the manager hasn't decided yet (APPROVE/REJECT).
   * "PENDING_CANCELLATION" → an already-approved request the owner asked to
   * cancel (APPROVE_CANCEL/REJECT_CANCEL). Other statuses never reach this
   * row type — the server filter excludes them.
   */
  status: RequestStatus;
  createdAt: string;
}

export interface PendingWfhRow {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string | null;
  status: RequestStatus;
  createdAt: string;
}

interface Props {
  initialLeave: PendingLeaveRow[];
  initialWfh: PendingWfhRow[];
}

type Kind = "leave" | "wfh";

// Calendar-date range format. createdAt and other instants should use
// formatInstantDate from lib/utils/timezone.
function fmtRange(startYmd: string, endYmd: string): string {
  return formatYmdRange(unsafeYmd(startYmd), unsafeYmd(endYmd));
}

export function ApprovalsClient({
  initialLeave,
  initialWfh,
}: Props): React.JSX.Element {
  // Default to the tab with pending work so a manager with only WFH
  // approvals doesn't land on an empty Leave tab. Ties favour Leave.
  const [tab, setTab] = React.useState<Kind>(
    initialLeave.length === 0 && initialWfh.length > 0 ? "wfh" : "leave",
  );
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
      <TabsList>
        <TabsTrigger value="leave">Leave ({initialLeave.length})</TabsTrigger>
        <TabsTrigger value="wfh">WFH ({initialWfh.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="leave" className="mt-4">
        <LeaveApprovalsList items={initialLeave} />
      </TabsContent>
      <TabsContent value="wfh" className="mt-4">
        <WfhApprovalsList items={initialWfh} />
      </TabsContent>
    </Tabs>
  );
}

// ---------- Leave ----------

function LeaveApprovalsList({
  items,
}: {
  items: PendingLeaveRow[];
}): React.JSX.Element {
  const qc = useQueryClient();
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = React.useState("");

  // Only PENDING rows are bulk-approvable. PENDING_CANCELLATION needs the
  // case-by-case "approve cancellation / reject cancellation" decision and
  // a balance-refund consequence — bulk-approving by accident would silently
  // refund days, so we restrict it to inline actions.
  const bulkable = React.useMemo(
    () => items.filter((r) => r.status === "PENDING"),
    [items],
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    if (selected.size === bulkable.length) setSelected(new Set());
    else setSelected(new Set(bulkable.map((i) => i.id)));
  }

  function reportError(err: unknown, fallback: string): void {
    toast.error(err instanceof ApiError ? err.message : fallback);
  }

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ["leave"] });
    void qc.invalidateQueries({ queryKey: ["approvals"] });
    router.refresh();
  }

  const reviewOne = useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: string;
      action: "APPROVE" | "REJECT" | "APPROVE_CANCEL" | "REJECT_CANCEL";
      note?: string;
    }) =>
      reviewLeave(id, {
        action,
        ...(note !== undefined && note.length > 0 ? { reviewerNote: note } : {}),
      }),
    onSuccess: (_data, vars) => {
      const map: Record<typeof vars.action, string> = {
        APPROVE: "Request approved",
        REJECT: "Request rejected",
        APPROVE_CANCEL: "Cancellation approved — balance refunded",
        REJECT_CANCEL: "Cancellation rejected — leave still approved",
      };
      toast.success(map[vars.action]);
      invalidate();
    },
    onError: (err) => reportError(err, "Could not record decision"),
  });

  const bulkApprove = useMutation({
    mutationFn: async (ids: string[]) => {
      // Sequential to keep audit log + notifications well-ordered. Volume is tiny.
      for (const id of ids) {
        await reviewLeave(id, {
          action: "APPROVE",
          ...(bulkNote.length > 0 ? { reviewerNote: bulkNote } : {}),
        });
      }
    },
    onSuccess: () => {
      toast.success(`Approved ${selected.size} request(s)`);
      setSelected(new Set());
      setBulkNote("");
      invalidate();
    },
    onError: (err) => reportError(err, "Bulk approve failed"),
  });

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheck />}
        title={emptyStates.noPendingApprovals.title}
        description={emptyStates.noPendingApprovals.description}
      />
    );
  }

  const allChecked = selected.size === bulkable.length && bulkable.length > 0;

  return (
    <div className="space-y-4">
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="bulkNote" className="text-xs">
                Note (optional)
              </Label>
              <Textarea
                id="bulkNote"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                rows={1}
                className="min-h-[2.5rem] w-72"
              />
            </div>
            <Button
              onClick={() => bulkApprove.mutate([...selected])}
              disabled={bulkApprove.isPending}
            >
              {bulkApprove.isPending
                ? "Approving…"
                : `Approve ${selected.size}`}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                  disabled={bulkable.length === 0}
                />
              </th>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Dates</th>
              <th className="px-3 py-2 text-left">Days</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-left">Submitted</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((row) => {
              const isCancel = row.status === "PENDING_CANCELLATION";
              return (
                <tr key={row.id} className="hover:bg-accent/30">
                  <td className="px-3 py-2">
                    {isCancel ? (
                      // Bulk action would silently refund balance — too
                      // consequential for a checkbox click. Inline only.
                      <span aria-hidden className="inline-block w-4" />
                    ) : (
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggle(row.id)}
                        aria-label={`Select ${row.employeeName}'s request`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={row.employeeName} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium">{row.employeeName}</p>
                        {isCancel ? (
                          <p className="text-[11px] font-medium uppercase tracking-wide text-orange-700 dark:text-orange-300">
                            Cancellation request
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <LeaveTypeBadge name={row.leaveTypeName} />
                  </td>
                  <td className="px-3 py-2">
                    {fmtRange(row.startDate, row.endDate)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatDays(row.totalDays)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.reason ?? "—"}
                  </td>
                  <td
                    className="px-3 py-2 text-xs text-muted-foreground tabular-nums"
                    title={formatInstant(row.createdAt)}
                  >
                    {formatRelative(row.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <ApprovePopover
                        label={isCancel ? "Approve cancellation" : "Approve"}
                        {...(isCancel
                          ? {
                              confirmHint: `Cancelling this leave will refund ${formatDays(row.totalDays)} to ${row.employeeName}'s balance.`,
                            }
                          : {})}
                        onConfirm={(note) =>
                          reviewOne.mutate({
                            id: row.id,
                            action: isCancel ? "APPROVE_CANCEL" : "APPROVE",
                            ...(note ? { note } : {}),
                          })
                        }
                        disabled={reviewOne.isPending}
                      />
                      <RejectModal
                        label={isCancel ? "Reject cancellation" : "Reject"}
                        title={
                          isCancel
                            ? "Reject this cancellation request?"
                            : "Reject request"
                        }
                        onConfirm={(note) =>
                          reviewOne.mutate({
                            id: row.id,
                            action: isCancel ? "REJECT_CANCEL" : "REJECT",
                            note,
                          })
                        }
                        disabled={reviewOne.isPending}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- WFH ----------

function WfhApprovalsList({
  items,
}: {
  items: PendingWfhRow[];
}): React.JSX.Element {
  const qc = useQueryClient();
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = React.useState("");

  // Same restriction as the leave table — only PENDING rows participate in
  // bulk approve. WFH cancellation rows are inline only.
  const bulkable = React.useMemo(
    () => items.filter((r) => r.status === "PENDING"),
    [items],
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll(): void {
    if (selected.size === bulkable.length) setSelected(new Set());
    else setSelected(new Set(bulkable.map((i) => i.id)));
  }

  function reportError(err: unknown, fallback: string): void {
    toast.error(err instanceof ApiError ? err.message : fallback);
  }
  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ["wfh"] });
    void qc.invalidateQueries({ queryKey: ["approvals"] });
    router.refresh();
  }

  const reviewOne = useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: string;
      action: "APPROVE" | "REJECT" | "APPROVE_CANCEL" | "REJECT_CANCEL";
      note?: string;
    }) =>
      reviewWfh(id, {
        action,
        ...(note !== undefined && note.length > 0 ? { reviewerNote: note } : {}),
      }),
    onSuccess: (_data, vars) => {
      const map: Record<typeof vars.action, string> = {
        APPROVE: "Request approved",
        REJECT: "Request rejected",
        APPROVE_CANCEL: "Cancellation approved",
        REJECT_CANCEL: "Cancellation rejected — WFH still approved",
      };
      toast.success(map[vars.action]);
      invalidate();
    },
    onError: (err) => reportError(err, "Could not record decision"),
  });

  const bulkApprove = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await reviewWfh(id, {
          action: "APPROVE",
          ...(bulkNote.length > 0 ? { reviewerNote: bulkNote } : {}),
        });
      }
    },
    onSuccess: () => {
      toast.success(`Approved ${selected.size} request(s)`);
      setSelected(new Set());
      setBulkNote("");
      invalidate();
    },
    onError: (err) => reportError(err, "Bulk approve failed"),
  });

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheck />}
        title={emptyStates.noPendingApprovals.title}
        description={emptyStates.noPendingApprovals.description}
      />
    );
  }

  const allChecked = selected.size === bulkable.length && bulkable.length > 0;

  return (
    <div className="space-y-4">
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="bulkNoteWfh" className="text-xs">
                Note (optional)
              </Label>
              <Textarea
                id="bulkNoteWfh"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                rows={1}
                className="min-h-[2.5rem] w-72"
              />
            </div>
            <Button
              onClick={() => bulkApprove.mutate([...selected])}
              disabled={bulkApprove.isPending}
            >
              {bulkApprove.isPending
                ? "Approving…"
                : `Approve ${selected.size}`}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                  disabled={bulkable.length === 0}
                />
              </th>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Dates</th>
              <th className="px-3 py-2 text-left">Days</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-left">Submitted</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((row) => {
              const isCancel = row.status === "PENDING_CANCELLATION";
              return (
                <tr key={row.id} className="hover:bg-accent/30">
                  <td className="px-3 py-2">
                    {isCancel ? (
                      <span aria-hidden className="inline-block w-4" />
                    ) : (
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggle(row.id)}
                        aria-label={`Select ${row.employeeName}'s request`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={row.employeeName} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium">{row.employeeName}</p>
                        {isCancel ? (
                          <p className="text-[11px] font-medium uppercase tracking-wide text-orange-700 dark:text-orange-300">
                            Cancellation request
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {fmtRange(row.startDate, row.endDate)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatDays(row.totalDays)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.reason ?? "—"}
                  </td>
                  <td
                    className="px-3 py-2 text-xs text-muted-foreground tabular-nums"
                    title={formatInstant(row.createdAt)}
                  >
                    {formatRelative(row.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <ApprovePopover
                        label={isCancel ? "Approve cancellation" : "Approve"}
                        onConfirm={(note) =>
                          reviewOne.mutate({
                            id: row.id,
                            action: isCancel ? "APPROVE_CANCEL" : "APPROVE",
                            ...(note ? { note } : {}),
                          })
                        }
                        disabled={reviewOne.isPending}
                      />
                      <RejectModal
                        label={isCancel ? "Reject cancellation" : "Reject"}
                        title={
                          isCancel
                            ? "Reject this cancellation request?"
                            : "Reject request"
                        }
                        onConfirm={(note) =>
                          reviewOne.mutate({
                            id: row.id,
                            action: isCancel ? "REJECT_CANCEL" : "REJECT",
                            note,
                          })
                        }
                        disabled={reviewOne.isPending}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Approve / Reject helpers ----------

function ApprovePopover({
  onConfirm,
  disabled,
  label = "Approve",
  confirmHint,
}: {
  onConfirm: (note: string | undefined) => void;
  disabled?: boolean;
  /** Trigger button text. Defaults to "Approve". */
  label?: string;
  /** Optional warning displayed inside the popover (e.g. balance refund). */
  confirmHint?: string;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="default" disabled={disabled}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        {confirmHint ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            {confirmHint}
          </p>
        ) : null}
        <Label htmlFor="approve-note" className="text-xs">
          Note (optional)
        </Label>
        <Textarea
          id="approve-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Add a note for the employee"
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onConfirm(note.length > 0 ? note : undefined);
              setNote("");
              setOpen(false);
            }}
          >
            {label}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RejectModal({
  onConfirm,
  disabled,
  label = "Reject",
  title = "Reject request",
}: {
  onConfirm: (note: string) => void;
  disabled?: boolean;
  /** Trigger button text. Defaults to "Reject". */
  label?: string;
  /** Dialog title. Defaults to "Reject request". */
  title?: string;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const trimmed = note.trim();
  const canSubmit = trimmed.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            A short note is required so the employee knows why.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-note">Reason</Label>
          <Textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            required
            aria-required
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              onConfirm(trimmed);
              setNote("");
              setOpen(false);
            }}
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
