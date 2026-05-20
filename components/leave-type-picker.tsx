"use client";

import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leaveTypeColor } from "@/lib/leave/colors";
import { cn } from "@/lib/utils";

export type LeaveTypeOption = {
  id: string;
  name: string;
  /** Disabled / not selectable (e.g. type is inactive). */
  disabled?: boolean;
};

type LeaveTypePickerProps = {
  leaveTypes: ReadonlyArray<LeaveTypeOption>;
  value?: string | undefined;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  ariaLabel?: string;
};

function Dot({ name }: { name: string }): React.JSX.Element {
  const c = leaveTypeColor(name);
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", c.dot)}
    />
  );
}

export function LeaveTypePicker({
  leaveTypes,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select leave type",
  disabled,
  id,
  name,
  className,
  ariaLabel,
}: LeaveTypePickerProps): React.JSX.Element {
  return (
    <Select
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      {...(onValueChange ? { onValueChange } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(name !== undefined ? { name } : {})}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel ?? placeholder}
        className={cn("h-10 transition-ui", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {leaveTypes.map((t) => (
          <SelectItem
            key={t.id}
            value={t.id}
            {...(t.disabled ? { disabled: true } : {})}
          >
            <span className="inline-flex items-center gap-2">
              <Dot name={t.name} />
              <span>{t.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
