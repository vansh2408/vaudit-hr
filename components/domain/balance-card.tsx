import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { leaveTypeColor } from "@/lib/leave/colors";
import { formatDays } from "@/lib/utils/format-days";
import { cn } from "@/lib/utils";

type BalanceCardProps = {
  typeName: string;
  allocated: number;
  used: number;
  /** Optional description below the title (e.g. "Year 2026") */
  description?: string;
  /**
   * When true, the leave type has no annual cap (e.g. Unpaid). The card
   * renders an "Unlimited / No annual cap" treatment instead of the
   * count + progress bar so the employee isn't shown a misleading "0 of
   * 0 days remaining". The actual balance check at the API layer also
   * bypasses isPaid=false types — this is the matching UI honesty.
   */
  unlimited?: boolean;
  className?: string;
};

function clampPercent(used: number, allocated: number): number {
  if (allocated <= 0) return 0;
  const pct = (used / allocated) * 100;
  if (Number.isNaN(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

export function BalanceCard({
  typeName,
  allocated,
  used,
  description,
  unlimited = false,
  className,
}: BalanceCardProps): React.JSX.Element {
  // allocated / used are HALF-DAY UNITS (0006). Convert to a fractional
  // "days" number for the big remaining figure, and pass through formatDays
  // for the subtitle + footer.
  //
  // For paid types `used` cannot exceed `allocated` (UI + API guard). For
  // Unpaid the cap is advisory, so `used` may legitimately go over — in
  // that case render the figure as overage ("3 days over") instead of
  // clamping silently to 0.
  const overUsed = used > allocated;
  const deltaUnits = overUsed ? used - allocated : allocated - used;
  const deltaDays = deltaUnits / 2;
  const deltaDisplay = Number.isInteger(deltaDays)
    ? `${deltaDays}`
    : deltaDays.toFixed(1);
  const pct = clampPercent(used, allocated);
  const color = leaveTypeColor(typeName);

  return (
    <Card className={cn("transition-ui hover:shadow-md", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("inline-block h-2.5 w-2.5 rounded-full", color.dot)}
          />
          <CardTitle className="text-base font-semibold">{typeName}</CardTitle>
        </div>
        {description ? (
          <CardDescription className="text-xs">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {unlimited ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-semibold">Unlimited</span>
              <span className="text-xs text-muted-foreground">No annual cap</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Requestable any time; no allocation is tracked for this type.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span
                className={cn(
                  "text-3xl font-semibold tabular-nums",
                  overUsed ? "text-destructive" : undefined,
                )}
              >
                {overUsed ? `+${deltaDisplay}` : deltaDisplay}
              </span>
              <span className="text-xs text-muted-foreground">
                {overUsed
                  ? `over ${formatDays(allocated)} allocation`
                  : `of ${formatDays(allocated)} remaining`}
              </span>
            </div>

            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={allocated || 0}
              aria-valuenow={used}
              aria-label={`${typeName} used`}
              className={cn(
                "h-2 w-full overflow-hidden rounded-full",
                color.bg,
              )}
            >
              <div
                className={cn("h-full transition-[width] duration-300", color.dot)}
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Used: {formatDays(used)}</span>
              <span>Allocated: {formatDays(allocated)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
