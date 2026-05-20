# ADR-0004: Notification fan-out (Slack + in-app)

- Status: Accepted
- Date: 2026-05-12
- Deciders: Architect

## Context

Every employee-facing event in the system needs to reach the right
person promptly (requests submitted, approved, rejected, cancelled,
auto-cancelled on deactivation). decisions.md A2 mandates **both** a
Slack DM and an in-app `notifications` row for each such event. The
birthday cron is the one documented exception (Slack DM only, A11).

## Decision

A single helper, `notifyEmployee`, is the only sanctioned path:

```ts
notifyEmployee({
  employeeId,
  slackUserId,
  type,
  message,
  link,
});
```

Implementation:

1. **DB write first.** Insert the `notifications` row. If this throws,
   the caller sees an error and the operation fails.
2. **Slack DM second.** Open an IM with `conversations.open`, then
   `chat.postMessage`. Any failure (rate-limited, user not in workspace,
   token rotated) is caught and swallowed — Slack errors MUST NOT block
   the DB write. The audit/Slack failure may be logged but not
   re-thrown.
3. **No queue, no Redis.** Calls are fire-and-forget at the call site
   but `await`ed inline so handler responses do not return before the
   DB write commits.

Routing rules (PRD "Notifications"):

| Event                                       | Recipient        |
| ------------------------------------------- | ---------------- |
| Leave/WFH submitted                         | manager          |
| Leave/WFH approved / rejected               | employee         |
| Leave/WFH cancelled by employee on APPROVED | manager (refund) |
| Employee deactivated w/ PENDING requests    | employee         |
| Birthday cron (Slack only)                  | HR_ADMIN         |

## Consequences

- One call site, one helper — no scattered `slack.send(...)` /
  `db.insert(notifications)` pairs that can drift.
- Slack outages degrade gracefully: the in-app bell still updates and
  the audit trail is correct.
- We do not retry failed DMs in v1. If this becomes a problem, add a
  `notifications.deliveryStatus` column and a small retry worker; the
  helper signature stays stable.

## Alternatives considered

- **Slack-only or in-app-only.** Loses the other half. Rejected by A2.
- **Event bus (Outbox + worker).** Over-engineered for ~50 users; would
  need Redis or a hosted queue.
- **Failing the request if Slack fails.** Bad UX — request status
  changes would be blocked by Slack incidents.
