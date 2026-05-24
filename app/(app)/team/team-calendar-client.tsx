"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Laptop } from "lucide-react";

import { TableSkeleton } from "@/components/feedback/skeletons";
import { Button } from "@/components/ui/button";
import { listTeamCalendar, queryKeys, type TeamCalendarItem } from "@/lib/api/queries";
import { leaveTypeColor } from "@/lib/leave/colors";
import {
  addDays,
  compareYmd,
  endOfMonth,
  endOfWeek,
  formatYmdHuman,
  localDateToYmd,
  parseYmd,
  startOfMonth,
  startOfWeek,
  todayYmd,
  unsafeYmd,
  ymdRange,
  ymdToLocalDate,
  type Ymd,
} from "@/lib/utils/dates";

type ViewMode = "month" | "week" | "day";

interface Props {
  holidayDatesYmd: ReadonlyArray<string>;
}

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * Calendar tab on `/team`. Read-only view of APPROVED + PENDING_CANCELLATION
 * leave + WFH for the people the caller can see (admin → everyone,
 * manager → direct reports). Auth is enforced by the API — this component
 * only renders.
 */
export function TeamCalendarClient({
  holidayDatesYmd,
}: Props): React.JSX.Element {
  // anchor = the focus date; what we mean by "current" varies by view:
  //   month → the month it lies in,
  //   week  → the Mon-Sun week,
  //   day   → that single day.
  const [view, setView] = React.useState<ViewMode>("month");
  const [anchor, setAnchor] = React.useState<Ymd>(todayYmd);

  // Compute the *fetch window* (always >= the visible window so the grid
  // doesn't paint blank cells while a network request is in flight).
  const bounds = React.useMemo(() => computeWindow(view, anchor), [view, anchor]);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: queryKeys.team.calendar(bounds.from, bounds.to),
    queryFn: () => listTeamCalendar({ from: bounds.from, to: bounds.to }),
    // Calendar data doesn't churn often; a short staleTime feels snappy
    // when navigating prev/next without spamming the API.
    staleTime: 30_000,
    // Keep the previous window's chips visible while the next window
    // loads. Without this, clicking prev/next paints an empty grid for
    // the duration of the round-trip.
    placeholderData: (prev) => prev,
  });

  const holidaySet = React.useMemo(
    () => new Set(holidayDatesYmd),
    [holidayDatesYmd],
  );

  const itemsByDay = React.useMemo(
    () => bucketByDay(data?.items ?? [], bounds.from, bounds.to),
    [data?.items, bounds.from, bounds.to],
  );

  function shift(delta: number): void {
    if (view === "month") {
      const d = ymdToLocalDate(anchor);
      setAnchor(localDateToYmd(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
    } else if (view === "week") {
      setAnchor(addDays(startOfWeek(anchor), delta * 7));
    } else {
      setAnchor(addDays(anchor, delta));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => shift(-1)}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(todayYmd())}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => shift(1)}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <h2 className="ml-2 text-base font-semibold tracking-tight">
            {windowTitle(view, anchor)}
          </h2>
        </div>
        <div
          role="tablist"
          aria-label="Calendar view"
          className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs"
        >
          {(["month", "week", "day"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded px-3 py-1.5 capitalize transition-colors ${
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : isError ? (
        <p className="rounded-md border border-dashed border-destructive/40 p-6 text-center text-sm text-destructive">
          Couldn&apos;t load the calendar. Try again in a moment.
        </p>
      ) : (
        // Dim while a follow-up fetch is in flight (prev/next nav).
        // `isLoading` was already handled above, so `isFetching` here
        // means "we already had data, now refreshing".
        <div
          className={`transition-opacity ${
            isFetching ? "opacity-60" : "opacity-100"
          }`}
          aria-busy={isFetching}
        >
          {view === "day" ? (
            <DayView
              date={anchor}
              items={itemsByDay.get(anchor) ?? []}
              isHoliday={holidaySet.has(anchor)}
            />
          ) : (
            <Grid
              dates={visibleDates(view, anchor)}
              itemsByDay={itemsByDay}
              isHoliday={(d) => holidaySet.has(d)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Window + dates

interface FetchBounds {
  from: Ymd;
  to: Ymd;
}

/**
 * Fetch window — always covers the *visible* dates plus a little buffer for
 * the month grid (which spills into the previous/next month's edges).
 */
function computeWindow(view: ViewMode, anchor: Ymd): FetchBounds {
  if (view === "month") {
    return {
      from: startOfWeek(startOfMonth(anchor)),
      to: endOfWeek(endOfMonth(anchor)),
    };
  }
  if (view === "week") {
    return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  }
  return { from: anchor, to: anchor };
}

/** The dates we actually render cells for. */
function visibleDates(view: ViewMode, anchor: Ymd): Ymd[] {
  if (view === "month") {
    return ymdRange(
      startOfWeek(startOfMonth(anchor)),
      endOfWeek(endOfMonth(anchor)),
    );
  }
  if (view === "week") {
    return ymdRange(startOfWeek(anchor), endOfWeek(anchor));
  }
  return [anchor];
}

function windowTitle(view: ViewMode, anchor: Ymd): string {
  if (view === "month") {
    return formatYmdHuman(anchor, { month: "long", year: "numeric" });
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = endOfWeek(anchor);
    const startTxt = formatYmdHuman(start, { month: "short", day: "numeric" });
    const endTxt = formatYmdHuman(end, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startTxt} – ${endTxt}`;
  }
  return formatYmdHuman(anchor, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Spread each item across the days it covers within the visible window.
 * Returns a Map<Ymd, items[]> keyed by the literal Ymd string so cell
 * lookups are O(1).
 */
function bucketByDay(
  items: ReadonlyArray<TeamCalendarItem>,
  from: string,
  to: string,
): Map<string, TeamCalendarItem[]> {
  const out = new Map<string, TeamCalendarItem[]>();
  const lo = unsafeYmd(from);
  const hi = unsafeYmd(to);
  for (const it of items) {
    const start = unsafeYmd(it.startDate);
    const end = unsafeYmd(it.endDate);
    // Clip to the visible window so we don't bucket dates outside the grid.
    const cur0 = compareYmd(start, lo) < 0 ? lo : start;
    const cur1 = compareYmd(end, hi) > 0 ? hi : end;
    for (const d of ymdRange(cur0, cur1)) {
      const bucket = out.get(d) ?? [];
      bucket.push(it);
      out.set(d, bucket);
    }
  }
  // Sort each bucket: WFH after leave, then by employee name (stable look).
  for (const arr of out.values()) {
    arr.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "leave" ? -1 : 1;
      return a.employeeName.localeCompare(b.employeeName);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grid (month + week share the same 7-column layout)

function Grid({
  dates,
  itemsByDay,
  isHoliday,
}: {
  dates: ReadonlyArray<Ymd>;
  itemsByDay: Map<string, TeamCalendarItem[]>;
  isHoliday: (d: Ymd) => boolean;
}): React.JSX.Element {
  const today = todayYmd();
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dates.map((d) => (
          <DayCell
            key={d}
            date={d}
            items={itemsByDay.get(d) ?? []}
            isToday={d === today}
            isHoliday={isHoliday(d)}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  date,
  items,
  isToday,
  isHoliday,
}: {
  date: Ymd;
  items: ReadonlyArray<TeamCalendarItem>;
  isToday: boolean;
  isHoliday: boolean;
}): React.JSX.Element {
  const dayNum = date.slice(8, 10).replace(/^0/, "");
  return (
    <div
      className={`min-h-[96px] border-b border-r border-border p-1.5 ${
        isHoliday ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums ${
            isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          {dayNum}
        </span>
        {isHoliday ? (
          <span className="truncate text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Holiday
          </span>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {items.map((it) => (
          <Chip key={`${it.kind}-${it.id}-${date}`} item={it} forDate={date} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips

function Chip({
  item,
  forDate,
}: {
  item: TeamCalendarItem;
  forDate: Ymd;
}): React.JSX.Element {
  const href = item.kind === "leave" ? `/leave/${item.id}` : `/wfh/${item.id}`;
  // Half-day annotation only matters when the cell *is* the half-day's date
  // (which equals start === end for half-day requests per the DB constraint).
  const showHalf = item.isHalfDay && forDate === item.startDate;
  const slot =
    item.halfDaySlot === "FIRST_HALF"
      ? "AM"
      : item.halfDaySlot === "SECOND_HALF"
        ? "PM"
        : null;

  if (item.kind === "wfh") {
    return (
      <Link
        href={href}
        title={chipTitle(item)}
        className="flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
      >
        <Laptop className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{item.employeeName}</span>
        {showHalf && slot ? (
          <span className="ml-auto text-[9px] uppercase opacity-80">{slot}</span>
        ) : null}
      </Link>
    );
  }

  // leave
  const c = leaveTypeColor(item.leaveTypeName ?? "");
  return (
    <Link
      href={href}
      title={chipTitle(item)}
      className={`flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${c.bg} ${c.fg}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`}
        aria-hidden
      />
      <span className="truncate">{item.employeeName}</span>
      {showHalf && slot ? (
        <span className="ml-auto text-[9px] uppercase opacity-80">{slot}</span>
      ) : null}
    </Link>
  );
}

function chipTitle(item: TeamCalendarItem): string {
  const label = item.kind === "wfh" ? "WFH" : item.leaveTypeName ?? "Leave";
  const range =
    item.startDate === item.endDate
      ? formatYmdHuman(parseYmd(item.startDate), {
          month: "short",
          day: "numeric",
        })
      : `${formatYmdHuman(parseYmd(item.startDate), {
          month: "short",
          day: "numeric",
        })} – ${formatYmdHuman(parseYmd(item.endDate), {
          month: "short",
          day: "numeric",
        })}`;
  const pendingSuffix =
    item.status === "PENDING_CANCELLATION" ? " · cancel pending" : "";
  return `${item.employeeName} · ${label} · ${range}${pendingSuffix}`;
}

// ---------------------------------------------------------------------------
// Day view

function DayView({
  date,
  items,
  isHoliday,
}: {
  date: Ymd;
  items: ReadonlyArray<TeamCalendarItem>;
  isHoliday: boolean;
}): React.JSX.Element {
  const leave = items.filter((i) => i.kind === "leave");
  const wfh = items.filter((i) => i.kind === "wfh");
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {isHoliday ? (
          <>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              Holiday.
            </span>{" "}
            Nobody scheduled for {formatYmdHuman(date)}.
          </>
        ) : (
          <>No leave or WFH on {formatYmdHuman(date)}.</>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {isHoliday ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          {formatYmdHuman(date)} is a company holiday.
        </p>
      ) : null}
      <DaySection title="On leave" items={leave} forDate={date} />
      <DaySection title="Working from home" items={wfh} forDate={date} />
    </div>
  );
}

function DaySection({
  title,
  items,
  forDate,
}: {
  title: string;
  items: ReadonlyArray<TeamCalendarItem>;
  forDate: Ymd;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <li key={`${it.kind}-${it.id}`}>
            <Chip item={it} forDate={forDate} />
          </li>
        ))}
      </ul>
    </section>
  );
}