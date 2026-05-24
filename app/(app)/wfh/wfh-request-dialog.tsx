"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";

import { DateRangePicker } from "@/components/forms/date-range-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { createWfh, editWfh } from "@/lib/api/queries";
import { calcWorkingHalfDays } from "@/lib/leave/working-days";
import {
  formatDays,
  isHalfDaySlot,
  type HalfDaySlot,
} from "@/lib/utils/format-days";
import {
  localDateToYmd,
  unsafeYmd,
  ymdToLocalDate,
  type Ymd,
} from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

export interface WfhEditTarget {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string | null;
  isHalfDay: boolean;
  halfDaySlot: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holidayDatesYmd: ReadonlyArray<string>;
  mode?: "create" | "edit";
  editTarget?: WfhEditTarget;
}

type DayMode = "FULL" | "FIRST_HALF" | "SECOND_HALF";

// Calendar-date conversion uses the central helper in lib/utils/dates so the
// rule "pickers use local Date; the wire uses YYYY-MM-DD" is enforced.

function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function WfhRequestDialog({
  open,
  onOpenChange,
  holidayDatesYmd,
  mode = "create",
  editTarget,
}: Props): React.JSX.Element {
  const isEdit = mode === "edit" && editTarget !== undefined;
  const qc = useQueryClient();
  const router = useRouter();
  // Local state for the date range — single source of truth, no RHF
  // double-bookkeeping. Initial values for edit mode are parsed from Ymd
  // strings into local-midnight Dates (the picker's expected format) via
  // ymdToLocalDate — never `new Date("YYYY-MM-DD")` (which is UTC).
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(
    isEdit
      ? {
          from: ymdToLocalDate(unsafeYmd(editTarget.startDate)),
          to: ymdToLocalDate(unsafeYmd(editTarget.endDate)),
        }
      : undefined,
  );
  const [reason, setReason] = React.useState(
    isEdit ? (editTarget.reason ?? "") : "",
  );
  const [dateError, setDateError] = React.useState<string | null>(null);
  const [dayMode, setDayMode] = React.useState<DayMode>(
    isEdit && editTarget.isHalfDay && isHalfDaySlot(editTarget.halfDaySlot)
      ? editTarget.halfDaySlot
      : "FULL",
  );

  // Reset state when dialog opens (or switches edit target). Without this,
  // closing+reopening on a different request would show stale values.
  const editKey = isEdit ? editTarget.id : "create";
  React.useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setDateRange({
        from: ymdToLocalDate(unsafeYmd(editTarget.startDate)),
        to: ymdToLocalDate(unsafeYmd(editTarget.endDate)),
      });
      setReason(editTarget.reason ?? "");
      setDayMode(
        editTarget.isHalfDay && isHalfDaySlot(editTarget.halfDaySlot)
          ? editTarget.halfDaySlot
          : "FULL",
      );
    } else {
      setDateRange(undefined);
      setReason("");
      setDayMode("FULL");
    }
    setDateError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editKey]);

  const holidayYmd = React.useMemo<Ymd[]>(
    () => holidayDatesYmd.map((s) => unsafeYmd(s)),
    [holidayDatesYmd],
  );

  const isHalfDay = dayMode !== "FULL";
  const halfDaySlot: HalfDaySlot | null =
    dayMode === "FIRST_HALF" ? "FIRST_HALF" : dayMode === "SECOND_HALF" ? "SECOND_HALF" : null;

  const workingHalfDays = React.useMemo(() => {
    if (!dateRange?.from) return null;
    const from = localDateToYmd(dateRange.from);
    const to = isHalfDay
      ? from
      : localDateToYmd(dateRange.to ?? dateRange.from);
    return calcWorkingHalfDays(from, to, holidayYmd, isHalfDay, halfDaySlot);
  }, [dateRange, holidayYmd, isHalfDay, halfDaySlot]);

  const submitMutation = useMutation({
    mutationFn: (input: {
      startDate: Date;
      endDate: Date;
      reason?: string;
      isHalfDay: boolean;
      halfDaySlot: HalfDaySlot | null;
    }) => {
      const payload = {
        startDate: localDateToYmd(input.startDate),
        endDate: localDateToYmd(input.endDate),
        isHalfDay: input.isHalfDay,
        halfDaySlot: input.halfDaySlot,
        ...(input.reason !== undefined && input.reason.length > 0
          ? { reason: input.reason }
          : {}),
      };
      return isEdit ? editWfh(editTarget.id, payload) : createWfh(payload);
    },
    onSuccess: (res) => {
      toast.success(
        isEdit
          ? `WFH request updated (${formatDays(res.totalDays)})`
          : `WFH request submitted (${formatDays(res.totalDays)})`,
      );
      void qc.invalidateQueries({ queryKey: ["wfh"] });
      // Re-run Server Components on the current route so the detail page
      // reflects new dates/reason without a hard reload.
      router.refresh();
      onOpenChange(false);
      if (!isEdit) {
        setDateRange(undefined);
        setReason("");
        setDayMode("FULL");
      }
      setDateError(null);
    },
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError
          ? err.message
          : isEdit
            ? "Could not update request"
            : "Could not submit request";
      toast.error(message);
    },
  });

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!dateRange?.from) {
      setDateError("Pick a date");
      return;
    }
    const from = dateRange.from;
    const to = isHalfDay ? from : (dateRange.to ?? from);
    if (to.getTime() < from.getTime()) {
      setDateError("End date must be on or after start date");
      return;
    }
    if (workingHalfDays !== null && workingHalfDays <= 0) {
      setDateError("Selected range has no working days");
      return;
    }
    setDateError(null);
    submitMutation.mutate({
      startDate: from,
      endDate: to,
      isHalfDay,
      halfDaySlot,
      ...(reason.length > 0 ? { reason } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit WFH request" : "New WFH request"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update dates or reason. Your manager will be notified to re-review."
              : "Pick a single day or a range. Your manager will be notified."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="wfh-dateRange">Dates</Label>
            <DateRangePicker
              id="wfh-dateRange"
              minDate={todayMidnight()}
              disableWeekends
              value={dateRange}
              onChange={(range) => {
                // Ignore react-day-picker's "deselect by re-click" callback —
                // single-day WFH is a valid intent.
                if (!range?.from) return;
                if (isHalfDay && range.to && range.to.getTime() !== range.from.getTime()) {
                  setDayMode("FULL");
                }
                setDateRange(range);
                setDateError(null);
              }}
              hint={
                workingHalfDays === 0 ? (
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    Every date in your selection is a public holiday — pick a different date.
                  </span>
                ) : workingHalfDays !== null ? (
                  formatDays(workingHalfDays)
                ) : (
                  "Weekends can't be picked. Holidays in your range are excluded automatically."
                )
              }
            />
            {dateError ? (
              <p className="text-xs font-medium text-destructive">
                {dateError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Day length</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="Day length">
              {([
                { value: "FULL" as const, label: "Full day" },
                { value: "FIRST_HALF" as const, label: "Morning only" },
                { value: "SECOND_HALF" as const, label: "Afternoon only" },
              ]).map((opt) => {
                const active = dayMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setDayMode(opt.value);
                      if (opt.value !== "FULL" && dateRange?.from) {
                        setDateRange({ from: dateRange.from, to: dateRange.from });
                      }
                    }}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-ui",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:bg-accent",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wfh-reason">Reason (optional)</Label>
            <Textarea
              id="wfh-reason"
              rows={3}
              placeholder="Add context for your manager"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                submitMutation.isPending ||
                (workingHalfDays !== null && workingHalfDays <= 0)
              }
            >
              {submitMutation.isPending
                ? isEdit
                  ? "Saving…"
                  : "Submitting…"
                : isEdit
                  ? "Save changes"
                  : "Submit request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
