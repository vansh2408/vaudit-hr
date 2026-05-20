/**
 * Leave-type colour map.
 *
 * Tailwind class strings are emitted as full literals (not interpolated) so the
 * JIT compiler picks them up. Each variant ships a light + dark pair targeting
 * WCAG AA contrast on its surface.
 */
export type LeaveColorClasses = {
  /** Background tint for badges/cards */
  bg: string;
  /** Foreground / text on the background tint */
  fg: string;
  /** Border tint */
  border: string;
  /** Solid dot for selects / legends */
  dot: string;
};

/** Canonical leave-type names per seed + PRD. */
export const LEAVE_TYPE_NAMES = [
  "Annual",
  "Sick",
  "Holiday Leave",
  "Personal",
  "Paternity",
  "Maternity",
  "Unpaid",
] as const;

export type LeaveTypeName = (typeof LEAVE_TYPE_NAMES)[number];

const PALETTE: Record<LeaveTypeName, LeaveColorClasses> = {
  Annual: {
    bg: "bg-sky-100 dark:bg-sky-950/60",
    fg: "text-sky-800 dark:text-sky-200",
    border: "border-sky-200 dark:border-sky-900",
    dot: "bg-sky-500 dark:bg-sky-400",
  },
  Sick: {
    bg: "bg-red-100 dark:bg-red-950/60",
    fg: "text-red-800 dark:text-red-200",
    border: "border-red-200 dark:border-red-900",
    dot: "bg-red-500 dark:bg-red-400",
  },
  "Holiday Leave": {
    bg: "bg-emerald-100 dark:bg-emerald-950/60",
    fg: "text-emerald-800 dark:text-emerald-200",
    border: "border-emerald-200 dark:border-emerald-900",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  Personal: {
    bg: "bg-violet-100 dark:bg-violet-950/60",
    fg: "text-violet-800 dark:text-violet-200",
    border: "border-violet-200 dark:border-violet-900",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
  Paternity: {
    bg: "bg-cyan-100 dark:bg-cyan-950/60",
    fg: "text-cyan-800 dark:text-cyan-200",
    border: "border-cyan-200 dark:border-cyan-900",
    dot: "bg-cyan-500 dark:bg-cyan-400",
  },
  Maternity: {
    bg: "bg-pink-100 dark:bg-pink-950/60",
    fg: "text-pink-800 dark:text-pink-200",
    border: "border-pink-200 dark:border-pink-900",
    dot: "bg-pink-500 dark:bg-pink-400",
  },
  Unpaid: {
    bg: "bg-slate-100 dark:bg-slate-800/70",
    fg: "text-slate-800 dark:text-slate-200",
    border: "border-slate-200 dark:border-slate-700",
    dot: "bg-slate-500 dark:bg-slate-400",
  },
};

const FALLBACK: LeaveColorClasses = {
  bg: "bg-muted",
  fg: "text-foreground",
  border: "border-border",
  dot: "bg-muted-foreground",
};

/** Resolve the colour bundle for a leave-type name. Unknown → neutral muted. */
export function leaveTypeColor(name: string): LeaveColorClasses {
  if ((LEAVE_TYPE_NAMES as readonly string[]).includes(name)) {
    return PALETTE[name as LeaveTypeName];
  }
  return FALLBACK;
}
