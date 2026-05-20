# ADR-0003: Role model and authorization

- Status: Superseded in part by ADR-0006 — the `MANAGER` role has been
  removed; manager approval permission is now derived from the org chart
  (`users.managerId`). The `EMPLOYEE`, `HR_ADMIN`, `SUPER_ADMIN` portions
  of this ADR remain in effect.
- Date: 2026-05-12
- Deciders: Architect, CEO

## Context

We need authorization that supports normal employees, line managers, an
HR team, and a tiny "owner" class who can change roles. Birthday DMs
should reach HR but not executives (decisions.md A11). The model has to
be cheap to enforce on every API call and obvious to read in code.

## Decision

A flat enum, ordered by privilege:

| Role        | Sees       | Can act on                                         |
| ----------- | ---------- | -------------------------------------------------- |
| EMPLOYEE    | self       | own profile + own requests                         |
| MANAGER     | + reports  | + approve/reject own direct reports' requests      |
| HR_ADMIN    | everyone   | + employee CRUD, balances, audit log, CSV import   |
| SUPER_ADMIN | everyone   | + change roles (HR_ADMIN superset)                 |

Implementation notes:

- Stored as a Postgres enum on `users.role` so DB constraints match the
  TypeScript union (`UserRole = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' |
  'SUPER_ADMIN'`).
- `requireAdmin = ['HR_ADMIN', 'SUPER_ADMIN']`.
- The birthday cron filters `role = 'HR_ADMIN'` only — SUPER_ADMIN does
  not receive birthday DMs (A11).
- The session callback re-reads the role from Postgres on every request
  (see ADR-0002), so role changes apply instantly.
- Row-level access is enforced in code (no Postgres RLS); guards live
  in `lib/auth/guards.ts` (`requireSession`, `requireRole`,
  `requireAdmin`). Every Route Handler calls one of them before any DB
  op (PRD "Security" section).
- Manager-of relationship is `users.managerId` self-FK. Cycle detection
  + self-management blocked server-side on every create/update including
  CSV bulk import (decisions.md A10).

## Consequences

- Four roles, no role hierarchy table, no per-resource ACLs — the model
  fits an internal HR app and stays readable.
- Authorization logic lives in handler code, not the DB, so we can run
  Drizzle against any Postgres without policy plumbing.
- Adding a fifth role (e.g. `READ_ONLY_AUDITOR`) means a migration on
  the enum + one switch addition; cheap.

## Alternatives considered

- **Role permissions table (RBAC)** — over-engineered for a fixed,
  four-tier hierarchy.
- **Postgres RLS** — adds operational surface (every DB user gets
  policies); skipped to keep migrations boring.
- **Single ADMIN role** — failed A11 (HR-only birthday DMs require
  separating HR_ADMIN from SUPER_ADMIN).
