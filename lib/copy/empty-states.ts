/**
 * Empty-state copy bank. Keyed strings consumed by <EmptyState />.
 * Title is sentence-case; description is one short sentence; ctaLabel optional.
 */
export type EmptyStateCopy = {
  title: string;
  description: string;
  ctaLabel?: string;
};

export const emptyStates = {
  noLeaveRequests: {
    title: "No leave requests yet",
    description:
      "When you submit time off, it'll show up here with status, dates, and any reviewer notes.",
    ctaLabel: "Request leave",
  },
  noPendingApprovals: {
    title: "Inbox zero",
    description:
      "There are no pending requests from your team right now. We'll surface new ones the moment they arrive.",
  },
  noNotifications: {
    title: "You're all caught up",
    description:
      "No new notifications. Approvals, mentions, and announcements will land here.",
  },
  noEmployees: {
    title: "No employees yet",
    description:
      "Add your first teammate manually or import a CSV to get everyone onboarded in one go.",
    ctaLabel: "Add employee",
  },
  noHolidays: {
    title: "No holidays configured",
    description:
      "Add company holidays so working-day calculations skip them automatically.",
    ctaLabel: "Add holiday",
  },
  noAuditLogs: {
    title: "Audit log is empty",
    description:
      "Sensitive actions like role changes, balance adjustments, and overrides will be recorded here.",
  },
  noTeamOnLeave: {
    title: "Everyone's in today",
    description:
      "No one on your team is on approved leave. Enjoy the full crew.",
  },
} as const satisfies Record<string, EmptyStateCopy>;

export type EmptyStateKey = keyof typeof emptyStates;
