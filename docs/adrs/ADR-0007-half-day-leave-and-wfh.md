# ADR-0007: Half-day leave and WFH via half-day-unit shift

- Status: Accepted
- Date: 2026-05-19
- Deciders: HR + CEO
- Supersedes: A4 (which said "Half-day leave: NOT supported in v1")

## Context

HR requested that employees be able to request half-day leave (and
half-day WFH) — e.g. "I need Monday morning off for a clinic visit, but
I'll be in by 2pm." Modern HR systems support this natively. Vaudit HR
v1 did not: every day-counter (`leave_balances.allocated`,
`leave_balances.used`, `leave_requests.total_days`, `wfh_requests.total_days`)
was an `integer` storing whole days, so there was no representation for
"half a day consumed" against a balance. The only honest options were:

1. Cosmetic-only half-day (UI says "Half day", balance still debits a
   full day). Easy to ship, lies to the employee, would generate
   complaints within a week.
2. Float / `numeric` columns to represent 0.5 days. Allows the math but
   imports the usual float-precision footguns (`0.1 + 0.2 !== 0.3`) into
   leave-balance accounting, which is a poor trade.
3. Unit shift: keep the columns as `integer` but reinterpret the unit
   from "1 day" to "1 half-day" globally. Existing data multiplied by 2
   in a one-time migration; from then on the unit is `½ day`.

Option 1 is dishonest and rejected. Option 2 trades schema simplicity
for runtime precision bugs. Option 3 preserves integer arithmetic, has
a single mechanical migration step, and leaves room for future
finer-grained units (quarter-days, hours) via another multiplier if HR
ever asks.

## Decision

Adopt option 3 — half-day-unit shift — as the canonical storage model
for all day-counts on the leave + WFH stack.

- Existing values multiplied by 2 in migration `0006_half_day_unit_shift.sql`,
  inside the same transaction as the schema additions so there is no
  window where columns exist but rows still carry day-units.
- New columns on `leave_requests` and `wfh_requests`:
  - `is_half_day BOOLEAN NOT NULL DEFAULT false`
  - `half_day_slot TEXT NULL` — values `'FIRST_HALF'` (UI label "Morning")
    or `'SECOND_HALF'` (UI label "Afternoon"); null when `is_half_day` is
    false.
- DB-level CHECK constraints (`chk_leave_half_day`, `chk_wfh_half_day`)
  enforce three invariants:
  1. `is_half_day = false ⇒ half_day_slot IS NULL`
  2. `is_half_day = true ⇒ half_day_slot ∈ {FIRST_HALF, SECOND_HALF}`
  3. `is_half_day = true ⇒ start_date = end_date` (single-date only in V1)
- The same invariants are enforced at the API boundary via Zod
  superRefine (`checkHalfDayInvariants` in `lib/validation/common.ts`) so
  callers see a friendly 400 instead of a Postgres constraint error.
- Policy gate: half-day requests are rejected for the `Maternity` and
  `Paternity` leave types via `isHalfDayAllowedForLeaveType` in
  `lib/leave/policies.ts`. All other leave types (Annual, Sick,
  Holiday Leave, Personal, Unpaid) permit half-day. WFH applies
  uniformly.
- Working-day calc: `calcWorkingHalfDays(start, end, holidays,
  isHalfDay, slot)` returns half-day units — for multi-day range,
  `2 × calcWorkingDays(...)`; for a half-day single date, `1` if the
  date is a working weekday not on a public holiday, `0` otherwise.
- Overlap rule (`lib/leave/overlap.ts` + `overlap-pure.ts`):
  - Two full-day ranges intersect ⇒ conflict.
  - A half-day request lands inside an existing full-day range ⇒
    conflict.
  - Two half-day requests on the same date and same slot ⇒ conflict.
  - Two half-day requests on the same date but different slots ⇒ OK
    (so morning leave + afternoon WFH on the same date is permitted).
- Display: a single `formatDays(halfDays)` helper renders every
  user-facing day-count ("Half day" / "1 day" / "1.5 days"). Detail
  pages also use `formatDaysWithSlot` to append `· Morning` /
  `· Afternoon`. Direct interpolation of `totalDays` into copy is a bug.

## Out of scope (V1 → V2)

- **First-day-half / last-day-half on a multi-day range** ("Mon full,
  Tue full, Wed morning only"). V1 requires the user to split it into
  two separate requests. V2 adds two checkboxes to the date picker and
  threads through to `calcWorkingHalfDays`. No further DB schema
  change required.
- **Arbitrary mid-range half-days**. Effectively no mature HR system
  supports this; not planned.
- **Quarter-day or hour granularity**. Schema is half-day-unit; a
  finer unit would need another `× N` migration.

## Consequences

- All callers that previously read `total_days` / `allocated` / `used`
  must treat the value as half-day units. The unit shift was carried
  out at every consumer in this commit set; new consumers must use
  `formatDays(...)` for display and must NOT do `× 1` arithmetic on
  the value assuming days.
- The migration is a one-way data change. Drizzle records it in
  `__drizzle_migrations` so it cannot apply twice on the same DB;
  running against a fresh DB also works (no rows yet → `*2` is a no-op).
- The API rejects with `ZERO_WORKING_DAYS` if a half-day single date
  lands on a weekend or public holiday — same code as multi-day ranges
  with no working days.
- The CHECK constraints are belt-and-braces against any future code
  path that bypasses Zod (direct SQL, drift in a later refactor).

## Alternatives considered

- **Float columns** (rejected) — precision bugs in money/balance-style
  arithmetic are notoriously hard to root-cause; integer half-days
  avoid them entirely.
- **Two-column representation** (`total_days INT` + `half_days_count INT`,
  rejected) — every consumer would have to remember to consult two
  columns and the display would do integer division at every site.
  Worse DX than the single-unit shift.
- **Per-request "fraction" enum** (`FULL | HALF`, rejected) — addresses
  the request-row representation but doesn't solve the balance side,
  which still needs sub-day precision.
- **A separate `is_half_day` flag with full-day billing** (rejected — see
  Context option 1) — dishonest.

## References

- A4 (superseded) — `docs/decisions.md`
- A22 (this decision summary) — `docs/decisions.md`
- Migration: `lib/db/migrations/0006_half_day_unit_shift.sql`
- Code: `lib/utils/format-days.ts`, `lib/leave/working-days.ts`,
  `lib/leave/policies.ts`, `lib/leave/overlap.ts`,
  `lib/leave/overlap-pure.ts`, `lib/validation/common.ts`
- Tests: `tests/unit/working-days.test.ts`,
  `tests/unit/format-days.test.ts`,
  `tests/unit/leave/overlap.test.ts`
