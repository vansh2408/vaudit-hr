"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { z } from "zod";

import { DateRangePicker } from "@/components/date-range-picker";
import { LeaveTypePicker } from "@/components/leave-type-picker";
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
import { createLeave, editLeave } from "@/lib/api/queries";
import { calcWorkingHalfDays } from "@/lib/leave/working-days";
import { isHalfDayAllowedForLeaveType } from "@/lib/leave/policies";
import {
  formatDays,
  isHalfDaySlot,
  type HalfDaySlot,
} from "@/lib/utils/format-days";
import { cn } from "@/lib/utils";
import {
  localDateToYmd,
  unsafeYmd,
  ymdToLocalDate,
  type Ymd,
} from "@/lib/utils/dates";
import type { LeaveTypeLite, MyBalanceLite } from "./leave-list-client";

export interface LeaveEditTarget {
  id: string;
  leaveTypeId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string | null;
  isHalfDay: boolean;
  halfDaySlot: string | null;
}

type DayMode = "FULL" | "FIRST_HALF" | "SECOND_HALF";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaveTypes: ReadonlyArray<LeaveTypeLite>;
  balancesByType: Record<string, MyBalanceLite>;
  currentYear: number;
  holidayDatesYmd: ReadonlyArray<string>;
  mode?: "create" | "edit";
  editTarget?: LeaveEditTarget;
}

// Dates are handled with local useState — they don't go through RHF.
// RHF was double-bookkeeping (its own state + DateRangePicker's internal
// state) and the two could disagree on the first click. Local state is the
// single source of truth now.
const formSchema = z.object({
  leaveTypeId: z.string().uuid("Pick a leave type"),
  reason: z.string().trim().max(2000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

// Calendar-date conversion uses the central helper in lib/utils/dates so the
// rule "pickers use local Date; the wire uses YYYY-MM-DD" is enforced.

function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function LeaveRequestDialog({
  open,
  onOpenChange,
  leaveTypes,
  balancesByType,
  currentYear,
  holidayDatesYmd,
  mode = "create",
  editTarget,
}: Props): React.JSX.Element {
  void currentYear;
  const isEdit = mode === "edit" && editTarget !== undefined;
  const qc = useQueryClient();
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      leaveTypeId: isEdit ? editTarget.leaveTypeId : "",
      reason: isEdit ? (editTarget.reason ?? "") : "",
    },
  });

  const watchedTypeId = form.watch("leaveTypeId");
  // Edit-mode dates: parse the Ymd string into a local-midnight Date via the
  // shared helper. NEVER use `new Date("YYYY-MM-DD")` here — that parses as
  // UTC midnight and shifts the visible day in any non-UTC timezone.
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(
    isEdit
      ? {
          from: ymdToLocalDate(unsafeYmd(editTarget.startDate)),
          to: ymdToLocalDate(unsafeYmd(editTarget.endDate)),
        }
      : undefined,
  );
  const [dateError, setDateError] = React.useState<string | null>(null);
  // dayMode controls the half-day radio. Initialised from editTarget when
  // editing; otherwise FULL. Switching to FIRST_HALF / SECOND_HALF collapses
  // any multi-day range down to its first date — half-day is single-date
  // only by API contract.
  const [dayMode, setDayMode] = React.useState<DayMode>(
    isEdit && editTarget.isHalfDay && isHalfDaySlot(editTarget.halfDaySlot)
      ? editTarget.halfDaySlot
      : "FULL",
  );

  // When the dialog reopens for a different request (or switches mode), reset
  // form + date state to match the new target. Without this, stale values
  // from a previous edit would persist across opens.
  const editKey = isEdit ? editTarget.id : "create";
  React.useEffect(() => {
    if (!open) return;
    if (isEdit) {
      form.reset({
        leaveTypeId: editTarget.leaveTypeId,
        reason: editTarget.reason ?? "",
      });
      setDateRange({
        from: ymdToLocalDate(unsafeYmd(editTarget.startDate)),
        to: ymdToLocalDate(unsafeYmd(editTarget.endDate)),
      });
      setDayMode(
        editTarget.isHalfDay && isHalfDaySlot(editTarget.halfDaySlot)
          ? editTarget.halfDaySlot
          : "FULL",
      );
    } else {
      form.reset({ leaveTypeId: "", reason: "" });
      setDateRange(undefined);
      setDayMode("FULL");
    }
    setDateError(null);
    // editKey changes whenever we switch targets; form.reset is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editKey]);

  const holidayYmd = React.useMemo<Ymd[]>(
    () => holidayDatesYmd.map((s) => unsafeYmd(s)),
    [holidayDatesYmd],
  );

  // Half-day forces the range to a single date; if dayMode is FIRST/SECOND
  // and the user still has a `to` set, treat as single-date for the calc.
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

  const selectedType = leaveTypes.find((t) => t.id === watchedTypeId);
  const halfDayAllowedForType = selectedType
    ? isHalfDayAllowedForLeaveType(selectedType.name)
    : true;
  // If the user switched to a type that blocks half-day while they had a
  // half-day mode selected, force back to FULL. Keeps the form internally
  // consistent without surprising error toasts on submit.
  React.useEffect(() => {
    if (!halfDayAllowedForType && dayMode !== "FULL") setDayMode("FULL");
  }, [halfDayAllowedForType, dayMode]);
  const selectedBalance = watchedTypeId
    ? balancesByType[watchedTypeId]
    : undefined;
  const remaining = selectedBalance
    ? Math.max(selectedBalance.allocated - selectedBalance.used, 0)
    : null;
  const insufficient =
    selectedType?.isPaid &&
    remaining !== null &&
    workingHalfDays !== null &&
    workingHalfDays > remaining;

  const submitMutation = useMutation({
    mutationFn: (input: {
      leaveTypeId: string;
      startDate: Date;
      endDate: Date;
      reason?: string;
      isHalfDay: boolean;
      halfDaySlot: HalfDaySlot | null;
    }) => {
      const payload = {
        leaveTypeId: input.leaveTypeId,
        startDate: localDateToYmd(input.startDate),
        endDate: localDateToYmd(input.endDate),
        isHalfDay: input.isHalfDay,
        halfDaySlot: input.halfDaySlot,
        ...(input.reason !== undefined && input.reason.length > 0
          ? { reason: input.reason }
          : {}),
      };
      return isEdit ? editLeave(editTarget.id, payload) : createLeave(payload);
    },
    onSuccess: (res) => {
      toast.success(
        isEdit
          ? `Request updated (${formatDays(res.totalDays)})`
          : `Request submitted (${formatDays(res.totalDays)})`,
      );
      void qc.invalidateQueries({ queryKey: ["leave"] });
      // RQ invalidation handles client-side caches; router.refresh re-runs
      // the Server Components above (e.g. the detail page reads its data
      // server-side, so without this the page would show stale values
      // until a hard reload).
      router.refresh();
      onOpenChange(false);
      if (!isEdit) {
        form.reset({ leaveTypeId: "", reason: "" });
        setDateRange(undefined);
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

  function onSubmit(values: FormValues): void {
    if (!dateRange?.from) {
      setDateError("Pick a date");
      return;
    }
    const from = dateRange.from;
    // Half-day always collapses to single-date; for FULL keep the picked
    // `to` (defaulting to `from` for single-day picks).
    const to = isHalfDay ? from : (dateRange.to ?? from);
    if (to.getTime() < from.getTime()) {
      setDateError("End date must be on or after start date");
      return;
    }
    setDateError(null);
    submitMutation.mutate({
      leaveTypeId: values.leaveTypeId,
      startDate: from,
      endDate: to,
      isHalfDay,
      halfDaySlot,
      ...(values.reason !== undefined && values.reason.length > 0
        ? { reason: values.reason }
        : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit leave request" : "New leave request"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update dates, type, or reason. Your manager will be notified to re-review."
              : "Pick a date range and leave type. We'll calculate working days and check your balance live."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="leaveTypeId">Leave type</Label>
            <Controller
              control={form.control}
              name="leaveTypeId"
              render={({ field }) => (
                <LeaveTypePicker
                  id="leaveTypeId"
                  leaveTypes={leaveTypes.map((t) => ({
                    id: t.id,
                    name: t.name,
                  }))}
                  value={field.value}
                  onValueChange={field.onChange}
                />
              )}
            />
            {form.formState.errors.leaveTypeId ? (
              <p className="text-xs font-medium text-destructive">
                {form.formState.errors.leaveTypeId.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dateRange">Dates</Label>
            <DateRangePicker
              id="dateRange"
              minDate={todayMidnight()}
              disableWeekends
              value={dateRange}
              onChange={(range) => {
                // react-day-picker's range mode treats "click the same `from`
                // date again" as a deselect — for an HR leave form that's the
                // wrong default (user expects single-day = start === end).
                // Ignore deselect callbacks; only react to real changes.
                if (!range?.from) return;
                // Half-day is single-date by API contract; if the user
                // expands into a range while in half-day mode, drop back
                // to FULL so the form stays valid.
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
                const disabled =
                  opt.value !== "FULL" && !halfDayAllowedForType;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      setDayMode(opt.value);
                      // Switching to half-day collapses the range to its
                      // start date — half-day is single-date only.
                      if (opt.value !== "FULL" && dateRange?.from) {
                        setDateRange({ from: dateRange.from, to: dateRange.from });
                      }
                    }}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-ui",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:bg-accent",
                      disabled && "cursor-not-allowed opacity-50 hover:bg-card",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {selectedType && !halfDayAllowedForType ? (
              <p className="text-xs text-muted-foreground">
                {selectedType.name} leave cannot be taken as a half day.
              </p>
            ) : null}
          </div>

          {selectedType && selectedBalance && selectedType.isPaid ? (
            <div
              className="rounded-md border border-border bg-muted/40 p-3 text-xs"
              aria-live="polite"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Remaining balance</span>
                <span className="tabular-nums">
                  {formatDays(remaining ?? 0)} of {formatDays(selectedBalance.allocated)}
                </span>
              </div>
              {insufficient && workingHalfDays !== null ? (
                <p className="mt-2 text-destructive">
                  Not enough balance. You need {formatDays(workingHalfDays)} but only have {formatDays(remaining ?? 0)}.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              rows={3}
              placeholder="Add context for your manager"
              {...form.register("reason")}
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
                Boolean(insufficient) ||
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
