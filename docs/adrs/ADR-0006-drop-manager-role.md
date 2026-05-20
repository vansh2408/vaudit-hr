# ADR-0006: Drop MANAGER as a role; derive manager status from the org chart

- Status: Accepted
- Date: 2026-05-13
- Deciders: CEO
- Supersedes: ADR-0003 (with respect to the MANAGER role only — EMPLOYEE,
  HR_ADMIN, SUPER_ADMIN are unchanged)

## Context

ADR-0003 defined a four-role enum: `EMPLOYEE`, `MANAGER`, `HR_ADMIN`,
`SUPER_ADMIN`. In practice this duplicated information:

- `users.role = 'MANAGER'` — categorical flag.
- `users.managerId` — structural foreign key (X is the manager of whoever
  has `managerId = X.id`).

These two stores could disagree. Real failure modes encountered:

1. HR adds direct reports to a user but forgets to change their role from
   `EMPLOYEE` → those reports' PENDING requests have no manager that can
   approve them (only HR can). Silent permission gap.
2. HR sets a user's role to `MANAGER` but doesn't assign reports → user
   has approval-capable role with no one to approve for. Harmless but a
   smell.
3. A manager hands off all reports to a peer but stays in `MANAGER` role
   → categorical role no longer reflects org reality, audit trail
   misleading.

The categorical role is a derived fact pretending to be primary data.

## Decision

Drop `MANAGER` from `user_role`. The enum is now
`EMPLOYEE | HR_ADMIN | SUPER_ADMIN`.

"Manager status" is derived: a user is a manager of someone iff that
someone's `users.managerId === user.id`. Approval permission becomes:

```
canApprove(viewer, request) =
  viewer.role IN ('HR_ADMIN', 'SUPER_ADMIN')
  OR request.employee.managerId === viewer.id
```

The session payload carries `isManager: boolean`, computed once per
session refresh as `EXISTS (SELECT 1 FROM users WHERE manager_id = me)`,
so client code can gate UI without re-querying.

Sidebar nav for `/approvals` and `/org-chart` shows when
`role IN admin OR isManager`.

## Consequences

**Gained**:

- One source of truth. Drift between role and org chart is now structurally
  impossible.
- HR mental model is simpler: promote someone by assigning reports to
  them. No second checkbox.
- The failure mode in scenario 1 (manager with reports but no approval
  role) is structurally eliminated.
- Audit log: role changes only fire for HR-tier promotions (rare,
  deliberate), not for every promotion/transfer.

**Given up**:

- "Title" semantics — a user with no current reports cannot be marked as
  "manager-in-name." For an internal HR tool of this scale, this is
  acceptable: title can be communicated via `position`/`department`.
- One extra `SELECT … LIMIT 1` per session refresh on the users table.
  Cost: ~1 ms with the existing `manager_id` index implied by the FK.
  Cached on the session object thereafter.

**Migration**:

- See `lib/db/migrations/0003_drop_manager_role.sql`.
- Existing `MANAGER` rows are demoted to `EMPLOYEE` before the enum is
  rebuilt. They retain approval rights for whoever still has them as
  `managerId` — only the redundant label goes away.

**Test fixtures**:

- The `SeededRole` test key `"MANAGER"` is retained as a fixture
  identifier for the seeded user who has direct reports (Morgan Lee /
  `manager@vaudit.com`). Her DB role is now `EMPLOYEE`; her approval
  ability comes from being Riley's `managerId`.
