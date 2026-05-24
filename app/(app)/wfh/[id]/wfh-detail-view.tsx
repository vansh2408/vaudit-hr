"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import {
  RequestTimeline,
  type RequestTimelineEntry,
} from "@/components/domain/request-timeline";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api/client";
import { cancelWfh, withdrawWfhCancellation } from "@/lib/api/queries";
import type { RequestStatus } from "@/lib/db/schema";
import { formatYmdHuman, unsafeYmd } from "@/lib/utils/dates";
import {
  formatDaysWithSlot,
  isHalfDaySlot,
} from "@/lib/utils/format-days";
import { WfhRequestDialog } from "../wfh-request-dialog";

interface Props {
  id: string;
  isOwn: boolean;
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
  /** Audit-log timeline. See LeaveDetailView for the same prop. */
  timeline: ReadonlyArray<RequestTimelineEntry>;
  // Holidays for the edit dialog's working-days calc. Populated only when
  // viewer can edit (isOwn && PENDING). Absent means the Edit button hides.
  editHolidayDatesYmd?: ReadonlyArray<string>;
}

function fmtDay(ymd: string): string {
  return formatYmdHuman(unsafeYmd(ymd), {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDayRange(startYmd: string, endYmd: string): string {
  if (startYmd === endYmd) return fmtDay(startYmd);
  return `${fmtDay(startYmd)} – ${fmtDay(endYmd)}`;
}

export function WfhDetailView({
  id,
  isOwn,
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
  editHolidayDatesYmd,
}: Props): React.JSX.Element {
  // Surfaced via <RequestTimeline /> now; props kept on the interface for
  // forward compatibility.
  void reviewerName;
  void reviewedAt;
  void createdAt;
  const qc = useQueryClient();
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);

  // Stale-state guard — see the leave detail view for the rationale.
  // BAD_STATE = "row drifted under you, refresh quietly". Business-rule
  // codes like PAST_LEAVE_LOCK fall through so the user sees the real
  // message rather than a misleading "refreshing…" toast.
  function handleStaleState(err: unknown): boolean {
    if (err instanceof ApiError && err.code === "BAD_STATE") {
      toast.info(
        "This request was just updated. Refreshing to the latest state…",
      );
      void qc.invalidateQueries({ queryKey: ["wfh"] });
      router.refresh();
      return true;
    }
    return false;
  }

  const cancelMutation = useMutation({
    mutationFn: () => cancelWfh(id),
    onSuccess: (res) => {
      const messages: Record<typeof res.action, string> = {
        cancelled: "WFH request cancelled",
        cancellation_requested:
          "Cancellation requested — waiting for your manager to approve",
        cancellation_approved: "Cancellation approved",
        cancellation_rejected: "Cancellation rejected",
        cancellation_withdrawn: "Cancellation withdrawn",
      };
      toast.success(messages[res.action]);
      void qc.invalidateQueries({ queryKey: ["wfh"] });
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
    mutationFn: () => withdrawWfhCancellation(id),
    onSuccess: () => {
      toast.success("Cancellation request withdrawn — your WFH remains approved");
      void qc.invalidateQueries({ queryKey: ["wfh"] });
      router.refresh();
    },
    onError: (err: unknown) => {
      if (handleStaleState(err)) return;
      const message =
        err instanceof ApiError ? err.message : "Could not withdraw cancellation";
      toast.error(message);
    },
  });

  const canCancel =
    isOwn && (status === "PENDING" || status === "APPROVED");
  const canWithdrawCancel = isOwn && status === "PENDING_CANCELLATION";
  const canEdit =
    isOwn && status === "PENDING" && editHolidayDatesYmd !== undefined;

  const cancelTitle =
    status === "APPROVED"
      ? "Request cancellation of this approved WFH?"
      : "Cancel this WFH request?";
  const cancelDescription =
    status === "APPROVED"
      ? "Your manager will be asked to approve the cancellation."
      : "This will cancel your pending request.";
  const cancelConfirmLabel =
    status === "APPROVED" ? "Request cancellation" : "Cancel request";
  const cancelButtonText =
    status === "APPROVED" ? "Request cancellation" : "Cancel request";

  return (
    <div className="space-y-6">
      {/* Same two-column layout as the Leave detail page — see comment there. */}
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
                    Dates
                  </dt>
                  <dd>{fmtDayRange(startDate, endDate)}</dd>
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
                <div className="space-y-1 sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Manager
                  </dt>
                  <dd>{managerName ?? "—"}</dd>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Reason
                  </dt>
                  <dd className="whitespace-pre-wrap text-sm text-foreground">
                    {reason && reason.length > 0 ? reason : "—"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {status === "PENDING_CANCELLATION" ? (
            <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
              You asked to cancel this WFH. Waiting for your manager to
              approve or reject the cancellation.
            </div>
          ) : null}

          {canCancel || canEdit || canWithdrawCancel ? (
            <div className="flex flex-wrap justify-end gap-2">
              {canEdit ? (
                <Button
                  variant="outline"
                  onClick={() => setEditOpen(true)}
                  aria-label="Edit WFH request"
                >
                  Edit
                </Button>
              ) : null}
              {canWithdrawCancel ? (
                <ConfirmDialog
                  title="Withdraw cancellation request?"
                  description="Your WFH goes back to approved. The manager is notified that you no longer want to cancel."
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
                      {cancelMutation.isPending ? "Working…" : cancelButtonText}
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

      {canEdit && editHolidayDatesYmd ? (
        <WfhRequestDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          holidayDatesYmd={editHolidayDatesYmd}
          mode="edit"
          editTarget={{ id, startDate, endDate, reason, isHalfDay, halfDaySlot }}
        />
      ) : null}
    </div>
  );
}
