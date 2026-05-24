"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import {
  RequestTimeline,
  type RequestTimelineEntry,
} from "@/components/domain/request-timeline";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api/client";
import { cancelLeave, withdrawLeaveCancellation } from "@/lib/api/queries";
import type { RequestStatus } from "@/lib/db/schema";
import { formatYmdHuman, unsafeYmd } from "@/lib/utils/dates";
import {
  formatDaysWithSlot,
  isHalfDaySlot,
} from "@/lib/utils/format-days";
import { LeaveRequestDialog } from "../leave-request-dialog";
import type {
  LeaveTypeLite,
  MyBalanceLite,
} from "../leave-list-client";

interface Props {
  id: string;
  isOwn: boolean;
  leaveTypeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  isHalfDay: boolean;
  halfDaySlot: string | null;
  reason: string | null;
  status: RequestStatus;
  managerName: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  createdAt: string;
  /**
   * Chronological audit-log entries (create / edit / approve / reject /
   * cancel / auto-cancel). Rendered as the Activity timeline, which is the
   * canonical source of truth for "what happened to this request" — so the
   * standalone Reviewer card and the Submitted field in the Summary are
   * absorbed into it.
   */
  timeline: ReadonlyArray<RequestTimelineEntry>;
  // Edit dialog dependencies — populated only when the viewer can edit
  // (isOwn && PENDING). When omitted, the Edit button does not render.
  editContext?: {
    leaveTypes: ReadonlyArray<LeaveTypeLite>;
    balancesByType: Record<string, MyBalanceLite>;
    currentYear: number;
    holidayDatesYmd: ReadonlyArray<string>;
  };
}

// Format a calendar date (YYYY-MM-DD) — never an instant. Use formatInstantDate
// for createdAt/reviewedAt.
function fmtDay(ymd: string): string {
  return formatYmdHuman(unsafeYmd(ymd), {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LeaveDetailView({
  id,
  isOwn,
  leaveTypeId,
  leaveTypeName,
  startDate,
  endDate,
  totalDays,
  isHalfDay,
  halfDaySlot,
  reason,
  status,
  managerName,
  reviewerName,
  reviewedAt,
  reviewerNote,
  createdAt,
  timeline,
  editContext,
}: Props): React.JSX.Element {
  // `reviewerName`, `reviewedAt`, `createdAt` are now surfaced via the
  // <RequestTimeline /> below, but the props are kept on the interface so
  // callers don't need to be refactored if we ever want them back inline.
  void reviewerName;
  void reviewedAt;
  void createdAt;
  const qc = useQueryClient();
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);

  // Stale-state guard: a mutation can race with a manager's parallel
  // action (approve/reject/cancel). The server returns 409 BAD_STATE
  // *only* for those state-drift cases; business-rule rejections (e.g.
  // PAST_LEAVE_LOCK when the leave already started) get their own codes
  // and fall through to the normal error toast so the user sees the real
  // reason instead of a misleading "refreshing…" message.
  function handleStaleState(err: unknown): boolean {
    if (err instanceof ApiError && err.code === "BAD_STATE") {
      toast.info(
        "This request was just updated. Refreshing to the latest state…",
      );
      void qc.invalidateQueries({ queryKey: ["leave"] });
      router.refresh();
      return true;
    }
    return false;
  }

  const cancelMutation = useMutation({
    mutationFn: () => cancelLeave(id),
    onSuccess: (res) => {
      const messages: Record<typeof res.action, string> = {
        cancelled: "Request cancelled",
        cancellation_requested:
          "Cancellation requested — waiting for your manager to approve",
        // The three below can only come from server-driven flows, not this
        // owner cancel button; included for type completeness.
        cancellation_approved: "Cancellation approved — balance refunded",
        cancellation_rejected: "Cancellation rejected",
        cancellation_withdrawn: "Cancellation withdrawn",
      };
      toast.success(messages[res.action]);
      void qc.invalidateQueries({ queryKey: ["leave"] });
      router.refresh();
    },
    onError: (err: unknown) => {
      if (handleStaleState(err)) return;
      const message =
        err instanceof ApiError ? err.message : "Could not cancel request";
      toast.error(message);
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: () => withdrawLeaveCancellation(id),
    onSuccess: () => {
      toast.success("Cancellation request withdrawn — your leave remains approved");
      void qc.invalidateQueries({ queryKey: ["leave"] });
      router.refresh();
    },
    onError: (err: unknown) => {
      if (handleStaleState(err)) return;
      const message =
        err instanceof ApiError ? err.message : "Could not withdraw cancellation";
      toast.error(message);
    },
  });

  // Owner can cancel a PENDING request (instant) or an APPROVED request
  // (queues a cancellation request for the manager). Once in
  // PENDING_CANCELLATION the cancel button is replaced by Withdraw.
  const canCancel =
    isOwn && (status === "PENDING" || status === "APPROVED");
  const canWithdrawCancel = isOwn && status === "PENDING_CANCELLATION";
  const canEdit = isOwn && status === "PENDING" && editContext !== undefined;

  // Cancel-button confirm copy adapts to status. The PENDING text is
  // unchanged; the APPROVED text now reflects the workflow (not instant).
  const cancelTitle =
    status === "APPROVED"
      ? "Request cancellation of this approved leave?"
      : "Cancel this leave request?";
  const cancelDescription =
    status === "APPROVED"
      ? "Your manager will be asked to approve the cancellation. Your balance will be refunded only after they approve."
      : "This will cancel your pending request. No balance change.";
  const cancelConfirmLabel =
    status === "APPROVED" ? "Request cancellation" : "Cancel request";
  const cancelButtonText =
    status === "APPROVED" ? "Request cancellation" : "Cancel request";

  return (
    <div className="space-y-6">
      {/* Two-column at lg+ — Summary + actions on the left (2/3) so Edit /
          Cancel stay reachable as the Activity log grows, narrower Activity
          rail on the right (1/3). Stacks on mobile with actions ordered
          before Activity so buttons remain visible without scrolling past
          history. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Summary</CardTitle>
              <StatusBadge status={status} />
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Type
                  </dt>
                  <dd>
                    <LeaveTypeBadge name={leaveTypeName} />
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Working days
                  </dt>
                  <dd className="tabular-nums">
                    {formatDaysWithSlot(
                      totalDays,
                      isHalfDay && isHalfDaySlot(halfDaySlot)
                        ? halfDaySlot
                        : null,
                    )}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Start
                  </dt>
                  <dd>{fmtDay(startDate)}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    End
                  </dt>
                  <dd>{fmtDay(endDate)}</dd>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Reason
                  </dt>
                  <dd className="whitespace-pre-wrap text-sm text-foreground">
                    {reason && reason.length > 0 ? reason : "—"}
                  </dd>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Manager
                  </dt>
                  <dd>{managerName ?? "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {status === "PENDING_CANCELLATION" ? (
            <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
              You asked to cancel this leave. Waiting for your manager to
              approve or reject the cancellation.
            </div>
          ) : null}

          {canCancel || canEdit || canWithdrawCancel ? (
            <div className="flex flex-wrap justify-end gap-2">
              {canEdit ? (
                <Button
                  variant="outline"
                  onClick={() => setEditOpen(true)}
                  aria-label="Edit leave request"
                >
                  Edit
                </Button>
              ) : null}
              {canWithdrawCancel ? (
                <ConfirmDialog
                  title="Withdraw cancellation request?"
                  description="Your leave goes back to approved. The manager is notified that you no longer want to cancel."
                  confirmLabel="Withdraw"
                  cancelLabel="Keep waiting"
                  onConfirm={async () => {
                    await withdrawMutation.mutateAsync();
                  }}
                  trigger={
                    <Button
                      variant="outline"
                      disabled={withdrawMutation.isPending}
                      aria-label="Withdraw cancellation request"
                    >
                      {withdrawMutation.isPending
                        ? "Withdrawing…"
                        : "Withdraw cancellation"}
                    </Button>
                  }
                />
              ) : null}
              {canCancel ? (
                <ConfirmDialog
                  title={cancelTitle}
                  description={cancelDescription}
                  confirmLabel={cancelConfirmLabel}
                  cancelLabel="Keep request"
                  onConfirm={async () => {
                    await cancelMutation.mutateAsync();
                  }}
                  trigger={
                    <Button
                      variant="destructive"
                      disabled={cancelMutation.isPending}
                      aria-label={cancelButtonText}
                    >
                      {cancelMutation.isPending
                        ? "Working…"
                        : cancelButtonText}
                    </Button>
                  }
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="lg:col-span-1">
          <RequestTimeline entries={timeline} reviewerNote={reviewerNote} />
        </div>
      </div>

      {canEdit && editContext ? (
        <LeaveRequestDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          editTarget={{ id, leaveTypeId, startDate, endDate, reason, isHalfDay, halfDaySlot }}
          leaveTypes={editContext.leaveTypes}
          balancesByType={editContext.balancesByType}
          currentYear={editContext.currentYear}
          holidayDatesYmd={editContext.holidayDatesYmd}
        />
      ) : null}
    </div>
  );
}
