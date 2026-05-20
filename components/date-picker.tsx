"use client";

import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  /** Current value as YYYY-MM-DD; pass undefined / "" for "unset". */
  value?: string | undefined;
  /** Fires with YYYY-MM-DD or undefined when cleared. */
  onChange?: (value: string | undefined) => void;
  /** Earliest selectable date (inclusive). */
  minDate?: Date;
  /** Latest selectable date (inclusive). */
  maxDate?: Date;
  placeholder?: string;
  /**
   * "dropdown" surfaces year + month dropdowns so birthdays and other
   * far-back dates don't need 50 clicks. Defaults to "dropdown".
   */
  captionLayout?: "label" | "dropdown" | "dropdown-months" | "dropdown-years";
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Forwarded to the trigger button for accessibility. */
  "aria-label"?: string;
};

function ymdToDate(ymd: string | undefined): Date | undefined {
  if (!ymd) return undefined;
  const d = parse(ymd, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
}

function dateToYmd(d: Date | undefined): string | undefined {
  return d ? format(d, "yyyy-MM-dd") : undefined;
}

export function DatePicker({
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = "Pick a date",
  captionLayout = "dropdown",
  disabled,
  id,
  className,
  ...rest
}: DatePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const date = ymdToDate(value);

  function handleSelect(d: Date | undefined): void {
    onChange?.(dateToYmd(d));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={rest["aria-label"] ?? placeholder}
          className={cn(
            "h-10 w-full justify-start gap-2 text-left font-normal transition-ui",
            !date && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">
            {date ? format(date, "LLL d, yyyy") : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          showOutsideDays={false}
          selected={date}
          onSelect={handleSelect}
          captionLayout={captionLayout}
          defaultMonth={date ?? maxDate ?? minDate ?? new Date()}
          disabled={(d) => {
            if (minDate && d < minDate) return true;
            if (maxDate && d > maxDate) return true;
            return false;
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
