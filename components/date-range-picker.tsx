"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DateRangePickerProps = {
  value?: DateRange | undefined;
  defaultValue?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  /** Earliest selectable date (inclusive). */
  minDate?: Date;
  /** Latest selectable date (inclusive). */
  maxDate?: Date;
  /**
   * When true, Saturdays and Sundays cannot be picked as the range start or
   * end. Weekend days that fall inside an otherwise-valid range remain
   * visible (and visually disabled) but the range still passes through them
   * — react-day-picker only blocks weekend dates as endpoints, not as
   * interior fillers. Use for leave/WFH where weekends never count as
   * working days.
   */
  disableWeekends?: boolean;
  /** Hint slot below the calendar, e.g. "5 working days". */
  hint?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

function formatRange(range: DateRange | undefined): string {
  if (!range?.from) return "";
  if (!range.to) return format(range.from, "LLL d, yyyy");
  return `${format(range.from, "LLL d")} – ${format(range.to, "LLL d, yyyy")}`;
}

export function DateRangePicker({
  value,
  defaultValue,
  onChange,
  minDate,
  maxDate,
  disableWeekends = false,
  hint,
  placeholder = "Pick a date range",
  disabled,
  id,
  className,
}: DateRangePickerProps): React.JSX.Element {
  const [internal, setInternal] = React.useState<DateRange | undefined>(defaultValue);
  const isControlled = value !== undefined;
  const range = isControlled ? value : internal;

  function setRange(next: DateRange | undefined): void {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  const label = formatRange(range) || placeholder;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-10 w-full justify-start gap-2 text-left font-normal transition-ui",
              !range?.from && "text-muted-foreground",
            )}
            aria-label={placeholder}
          >
            <CalendarIcon className="h-4 w-4" aria-hidden />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            numberOfMonths={2}
            // Don't bleed days from adjacent months into the grid — when a
            // range spans a month boundary the same date renders twice
            // (once in its real month, once as filler) and both get the
            // selected style, which looks like duplicate selections.
            showOutsideDays={false}
            defaultMonth={range?.from ?? minDate ?? new Date()}
            {...(range ? { selected: range } : {})}
            onSelect={setRange}
            {...(minDate ? { fromDate: minDate } : {})}
            {...(maxDate ? { toDate: maxDate } : {})}
            disabled={(date) => {
              if (minDate && date < minDate) return true;
              if (maxDate && date > maxDate) return true;
              if (disableWeekends) {
                const dow = date.getDay();
                if (dow === 0 || dow === 6) return true;
              }
              return false;
            }}
          />
        </PopoverContent>
      </Popover>
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
