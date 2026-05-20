# ADR-0001: Technology stack

- Status: Accepted
- Date: 2026-05-12
- Deciders: Architect, CEO

## Context

Vaudit / BlokID need an internal HR system for ~50 employees covering
employee directory, leave + WFH requests, manager approvals, an org chart,
and Slack-based notifications. The team is small, deploys on Vercel-class
hosting, and has no platform team. Build velocity, type safety, and a
single language across the stack matter more than horizontal scale.

## Decision

We adopt the following stack:

- **Next.js 14 (App Router)** with Route Handlers for the API surface.
- **TypeScript strict** (`noUncheckedIndexedAccess`, `noImplicitOverride`,
  `exactOptionalPropertyTypes`, no `any`).
- **PostgreSQL** managed by **Drizzle ORM** with `drizzle-kit` migrations
  checked into git, plus `drizzle-zod` for boundary validation.
- **NextAuth v5** + Google OAuth + Drizzle adapter; database session
  strategy so roles are always re-read from Postgres (see ADR-0002).
- **shadcn/ui + Tailwind CSS** for primitives, **next-themes** for dark mode,
  **TanStack Query v5** for client data, **React Hook Form + Zod** for
  forms, **Sonner** for toasts, **react-d3-tree** for the org chart,
  **lucide-react** for icons, **date-fns** for date math.
- **Slack Web API** via global `fetch` (no Bolt SDK, no Redis).
- **Google Apps Script** as the external cron trigger for birthday DMs;
  the app exposes `POST /api/cron/birthdays` guarded by `CRON_SECRET`.
- **Vitest** + **Playwright** for tests.

## Consequences

- Single TypeScript codebase: server, client, scripts.
- Drizzle gives us schema-as-source-of-truth plus generated Zod schemas;
  no duplicate type definitions between DB and API.
- No background worker infra, no Redis: simpler deploys, but any future
  rate limiting (decisions.md A3) will need a hosted store. Stub already
  in `lib/security/rate-limit.ts`.
- shadcn/ui is copy-paste, not a versioned dependency — design changes
  ship in our repo.
- App Router Route Handlers are colocated with pages; this couples API
  to the deploy unit, which is fine for ~50 internal users.

## Alternatives considered

- **Prisma** — heavier runtime, harder migration story. Drizzle wins on
  bundle size and the SQL-shaped builder.
- **Clerk / Auth0** — adds a third-party identity store and a per-seat
  bill. NextAuth + Google OAuth + DB-backed roles is sufficient and
  keeps roles inside our own Postgres.
- **tRPC** — extra layer for a single-team codebase; Route Handlers +
  Zod are enough and avoid the client/server type coupling debt.
- **React Flow** for org chart — heavier and graph-shaped; tree shape
  here means `react-d3-tree` is the right size (decisions.md A5).
