# ADR-0005: CSV bulk employee import

- Status: Accepted
- Date: 2026-05-12
- Deciders: Architect, HR

## Context

HR needs to onboard a batch of employees at once (decisions.md A16).
The CSV contains a `managerEmail` column that references another row
in the same file, so the import cannot simply insert row-by-row. It
also has to enforce self-management and cycle detection (decisions.md
A10) and create the per-leave-type balances HR expects.

## Decision

Two-pass import inside a single transaction:

1. **Validate.** Parse the CSV server-side with Zod row-by-row. Each
   row is validated independently; row errors are collected with line
   numbers and surfaced in a dry-run preview before commit. The user
   confirms the preview, then the actual commit runs.
2. **Pass 1 — insert with null `managerId`.** For each row, upsert
   into `users` keyed by email. The chosen policy ("skip existing" vs.
   "update existing") is selected per-import in the UI.
3. **Pass 2 — resolve `managerEmail` → `managerId`.** For every row
   that named a manager, look up that manager's row and set
   `managerId`. Reject the whole import if a `managerEmail` cannot be
   resolved.
4. **Cycle detection.** After Pass 2, walk up the manager chain for
   each inserted row. If we ever land on the same id we started from,
   reject the import with the offending row pair listed.
5. **Auto-create balances.** For every inserted user, insert
   `(employeeId, leaveTypeId, year=currentYear, allocated=defaultBalance,
   used=0)` for every active leave type. Conflict on the
   `(employee, type, year)` unique index is a no-op.
6. **Audit log.** Emit one `csv.import.commit` audit row capturing
   filename, row counts, and the chosen existing-email policy.

The dry-run path runs everything except the final commit so HR sees
the exact rows that will change.

## Consequences

- HR can move from a spreadsheet to a populated system in one step.
- Cycle detection happens on the resolved graph, not just per-row,
  catching cases that span multiple new rows.
- Failures are atomic — either the whole batch lands or none of it.
- The transaction can be long for large imports; at ~50 employees it
  is comfortable. If we ever import 10k rows we'd need to chunk.

## Alternatives considered

- **Single-pass insert** — cannot resolve forward references
  (`managerEmail`) that appear later in the file.
- **Background job + email when done** — operational overhead we do
  not need at this scale; the import is synchronous and fast.
- **Client-side validation only** — Zod runs server-side at the
  boundary regardless (PRD "Security"); the client preview is a UX
  affordance, not the source of truth.
