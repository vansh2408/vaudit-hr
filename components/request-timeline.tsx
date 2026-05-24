import * as React from "react";
import {
  CheckCircle2,
  CircleDot,
  CircleSlash,
  Pencil,
  PlusCircle,
  UserMinus,
  XCircle,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatInstant } from "@/lib/utils/timezone";

export interface RequestTimelineEntry {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface Props {
  entries: ReadonlyArray<RequestTimelineEntry>;
  /**
   * Reviewer note from the request row. Attached to the latest approve/reject
   * entry so the reader sees the context inline with the decision.
   */
  reviewerNote?: string | null;
}

interface ActionMeta {
  label: string;
  icon: React.JSX.Element;
  tone: "neutral" | "positive" | "negative" | "warning";
}

function metaFor(action: string): ActionMeta {
  switch (action) {
    case "leave.create":
    case "wfh.create":
      return {
        label: "Submitted",
        icon: <PlusCircle className="h-3.5 w-3.5" aria-hidden />,
        tone: "neutral",
      };
    case "leave.edit":
    case "wfh.edit":
      return {
        label: "Edited",
        icon: <Pencil className="h-3.5 w-3.5" aria-hidden />,
        tone: "neutral",
      };
    case "leave.approve":
    case "wfh.approve":
      return {
        label: "Approved",
        icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
        tone: "positive",
      };
    case "leave.reject":
    case "wfh.reject":
      return {
        label: "Rejected",
        icon: <XCircle className="h-3.5 w-3.5" aria-hidden />,
        tone: "negative",
      };
    case "leave.cancel_pending":
    case "wfh.cancel_pending":
      return {
        label: "Cancelled",
        icon: <CircleSlash className="h-3.5 w-3.5" aria-hidden />,
        tone: "warning",
      };
    case "leave.cancel_requested":
    case "wfh.cancel_requested":
      return {
        label: "Cancellation requested",
        icon: <CircleSlash className="h-3.5 w-3.5" aria-hidden />,
        tone: "warning",
      };
    case "leave.cancel_approved":
      return {
        label: "Cancellation approved — balance refunded",
        icon: <CircleSlash className="h-3.5 w-3.5" aria-hidden />,
        tone: "warning",
      };
    case "wfh.cancel_approved":
      return {
        label: "Cancellation approved",
        icon: <CircleSlash className="h-3.5 w-3.5" aria-hidden />,
        tone: "warning",
      };
    case "leave.cancel_rejected":
    case "wfh.cancel_rejected":
      return {
        label: "Cancellation rejected",
        icon: <XCircle className="h-3.5 w-3.5" aria-hidden />,
        tone: "negative",
      };
    case "leave.cancel_withdrawn":
    case "wfh.cancel_withdrawn":
      return {
        label: "Cancellation withdrawn",
        icon: <CircleDot className="h-3.5 w-3.5" aria-hidden />,
        tone: "neutral",
      };
    case "leave.cancel_admin_override":
    case "wfh.cancel_admin_override":
      return {
        label: "Cancelled by admin",
        icon: <CircleSlash className="h-3.5 w-3.5" aria-hidden />,
        tone: "warning",
      };
    case "leave.auto_cancel_on_deactivate":
    case "wfh.auto_cancel_on_deactivate":
      return {
        label: "Auto-cancelled (employee deactivated)",
        icon: <UserMinus className="h-3.5 w-3.5" aria-hidden />,
        tone: "warning",
      };
    default:
      // Unknown action — surface the raw code rather than swallowing it so
      // audit history is never silently lost in the UI.
      return {
        label: action,
        icon: <CircleDot className="h-3.5 w-3.5" aria-hidden />,
        tone: "neutral",
      };
  }
}

// "Decision" actions write the reviewerNote column. The note attaches in the
// UI to the most recent decision so the reviewer's explanation appears next
// to the decision they made — not to a stale earlier one.
function isDecisionWithNote(action: string): boolean {
  return (
    action === "leave.approve" ||
    action === "leave.reject" ||
    action === "leave.cancel_rejected" ||
    action === "wfh.approve" ||
    action === "wfh.reject" ||
    action === "wfh.cancel_rejected"
  );
}

function isAdminOverride(action: string): boolean {
  return (
    action === "leave.cancel_admin_override" ||
    action === "wfh.cancel_admin_override"
  );
}

function isEdit(action: string): boolean {
  return action === "leave.edit" || action === "wfh.edit";
}

// Field-name → human label for `edit` audit metadata diffs. Reads `before`
// and `after` from the metadata and reports which keys changed. Returns null
// if either side is missing or no field changed (defensive — shouldn't
// happen in practice but a null avoids rendering "Changed: ").
function describeChangedFields(
  metadata: Record<string, unknown>,
): string | null {
  const before = metadata["before"];
  const after = metadata["after"];
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object"
  ) {
    return null;
  }
  const beforeRec = before as Record<string, unknown>;
  const afterRec = after as Record<string, unknown>;
  // Both key names appear in audit_logs: pre-rename rows wrote `totalDays`
  // (still half-day units, just badly named); post-rename rows write
  // `totalHalfDays`. A row only carries one of them, so listing both here
  // produces the right "Changed: working days" tag in either case.
  const fieldDisplay: Record<string, string> = {
    startDate: "start date",
    endDate: "end date",
    leaveTypeId: "type",
    totalHalfDays: "working days",
    totalDays: "working days",
    reason: "reason",
  };
  // Set-dedupe so a row that (defensively) carries both totalDays and
  // totalHalfDays doesn't render "Changed: working days, working days".
  const changed = new Set<string>();
  for (const key of Object.keys(fieldDisplay)) {
    if (beforeRec[key] !== afterRec[key]) {
      changed.add(fieldDisplay[key]!);
    }
  }
  if (changed.size === 0) return null;
  return `Changed: ${[...changed].join(", ")}`;
}

export function RequestTimeline({
  entries,
  reviewerNote,
}: Props): React.JSX.Element | null {
  if (entries.length === 0) return null;

  // Reviewer note lives on the request row (single column, latest decision
  // wins). Find the most recent decision-with-note in chronological order so
  // the note attaches to the right entry — even if a later non-decision
  // event (e.g. cancel_withdrawn) followed.
  let lastDecisionId: string | null = null;
  for (const e of entries) {
    if (isDecisionWithNote(e.action)) lastDecisionId = e.id;
  }

  // Display newest-first. The fetcher returns entries chronologically (oldest
  // first) so the caller can reason about ordering naturally — we only flip
  // for presentation here. Doesn't affect `lastDecisionId` lookup above.
  const displayed = [...entries].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-0">
          {displayed.map((entry, i) => {
            const m = metaFor(entry.action);
            const isLast = i === displayed.length - 1;
            const note =
              entry.id === lastDecisionId &&
              typeof reviewerNote === "string" &&
              reviewerNote.length > 0
                ? reviewerNote
                : isAdminOverride(entry.action) &&
                    typeof entry.metadata["reason"] === "string" &&
                    (entry.metadata["reason"] as string).length > 0
                  ? (entry.metadata["reason"] as string)
                  : null;
            const diff = isEdit(entry.action)
              ? describeChangedFields(entry.metadata)
              : null;
            return (
              <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
                {!isLast ? (
                  <span
                    aria-hidden
                    className="absolute left-[10px] top-7 h-full w-px bg-border"
                  />
                ) : null}
                <span
                  className={cn(
                    "relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                    m.tone === "positive" &&
                      "bg-emerald-100 text-emerald-700",
                    m.tone === "negative" && "bg-red-100 text-red-700",
                    m.tone === "warning" && "bg-amber-100 text-amber-700",
                    m.tone === "neutral" &&
                      "bg-muted text-muted-foreground",
                  )}
                >
                  {m.icon}
                </span>
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-foreground">
                      {m.label}
                    </span>
                    {entry.actorName ? (
                      <span className="text-muted-foreground">
                        by {entry.actorName}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      · {formatInstant(entry.createdAt)}
                    </span>
                  </div>
                  {diff ? (
                    <p className="text-xs text-muted-foreground">{diff}</p>
                  ) : null}
                  {note ? (
                    <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-xs text-foreground">
                      {note}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}