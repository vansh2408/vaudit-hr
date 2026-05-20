# Vaudit HR

Internal HR management system for Vaudit / BlokID (~50 employees).
Production-grade Next.js 14 App Router + Drizzle + PostgreSQL + NextAuth v5.

## Quickstart

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env.local
# Then fill in DATABASE_URL, NEXTAUTH_SECRET, Google OAuth, Slack, CRON_SECRET.

# 3. Generate + apply migrations
npm run db:generate
npm run db:migrate

# 4. Seed the database (4 test users, 7 leave types, sample holidays)
npm run db:seed

# 5. Run the dev server
npm run dev
```

Visit http://localhost:3000.

## Scripts

| Command            | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `npm run dev`      | Next.js dev server                                   |
| `npm run build`    | Production build                                     |
| `npm run start`    | Run the production build                             |
| `npm run lint`     | ESLint (Next.js config + Prettier)                   |
| `npm run typecheck`| TypeScript strict no-emit check                      |
| `npm run db:generate` | Generate a new Drizzle migration from `lib/db/schema.ts` |
| `npm run db:migrate`  | Apply pending migrations                          |
| `npm run db:seed`     | Seed users, leave types, holidays, balances       |
| `npm run test`        | Vitest unit tests                                 |
| `npm run test:watch`  | Vitest watch mode                                 |
| `npm run test:e2e`    | Playwright end-to-end tests                       |
| `npm run format`      | Prettier write                                    |

## Layout

```
app/                  Next.js App Router (routes + Route Handlers)
components/           UI (shadcn/ui in components/ui)
lib/db/               Drizzle schema, migrations, client
lib/auth/             NextAuth v5 config + guards
lib/leave/            Working-days, balance, validation
lib/slack/            Slack Web API client
lib/notify/           Unified notifyEmployee fan-out
lib/audit/            Audit-log writer
lib/validation/       Shared Zod schemas
lib/security/         Rate-limit stub (decisions.md A3)
scripts/              seed.ts, migrate.ts
docs/                 PRD, decisions log, ADRs
tests/                Vitest (unit) + Playwright (e2e)
```

See `docs/prd.md` for the full PRD, `docs/decisions.md` for ratified
architecture decisions, and `docs/adrs/` for ADRs.

## Test accounts (after `db:seed`)

| Email                  | Role        | Notes                                       |
| ---------------------- | ----------- | ------------------------------------------- |
| ceo@vaudit.com         | SUPER_ADMIN |                                             |
| admin@vaudit.com       | HR_ADMIN    |                                             |
| manager@vaudit.com     | EMPLOYEE    | Manages `employee@vaudit.com` via `managerId` — has approval rights structurally, not via role (ADR-0006) |
| employee@vaudit.com    | EMPLOYEE    | Reports to `manager@vaudit.com`             |
