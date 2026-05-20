# Secrets & Configuration Inventory

Every environment variable consumed by Vaudit HR, its classification,
where in the codebase it is read, and how it must never leak into the
client bundle. Pulled from `docs/prd.md` § "Env vars" and verified
against `grep -rn process.env lib app scripts`.

## Classification key

- **server-only** — read from `process.env` exclusively in server code
  (Route Handlers, Server Actions, Server Components, scripts). MUST
  never carry the `NEXT_PUBLIC_` prefix. Leakage = security incident.
- **build-only** — read at build time only (e.g. for typed routes,
  metadata). No runtime exposure.
- **public** — explicitly safe to ship in the client bundle. Must use
  the `NEXT_PUBLIC_` prefix; reviewer flag any other public env vars.

## Inventory

| Variable | Classification | Read at | Purpose |
|----------|----------------|---------|---------|
| `DATABASE_URL` | server-only | `lib/db/index.ts:10`, `scripts/migrate.ts:11`, `scripts/seed.ts:145` | Postgres connection string (contains password). |
| `NEXTAUTH_SECRET` | server-only | implicit, read by NextAuth core | Symmetric key for session encryption / signing. |
| `NEXTAUTH_URL` | server-only | implicit, read by NextAuth core | Canonical base URL for OAuth redirect callbacks. |
| `GOOGLE_CLIENT_ID` | server-only | `lib/auth/config.ts:108` | Google OAuth public-client identifier. Considered non-secret in Google's model but kept server-side so the OAuth provider is configured in one place. |
| `GOOGLE_CLIENT_SECRET` | server-only | `lib/auth/config.ts:109` | Google OAuth client secret. Critical. |
| `ALLOWED_EMAIL_DOMAINS` | server-only | `lib/auth/config.ts:135` | Comma-separated allow-list of email domains. Drives the domain enforcement in the `signIn` callback. |
| `SLACK_BOT_TOKEN` | server-only | `lib/slack/client.ts:18` | Bearer token for the Slack Web API. Slack admin-equivalent — high blast radius. |
| `SLACK_HR_ADMIN_SLACK_USER_ID` | server-only | (Phase 1 cron handler, not yet wired) | Slack `U…` ID of the HR person who receives birthday DMs. Not a secret, but server-only to avoid coupling client UI to Slack identifiers. |
| `CRON_SECRET` | server-only | (Phase 1 cron handler, not yet wired) | Bearer secret for `/api/cron/birthdays`. Must be compared via `timingSafeEqualString` (`lib/security/constant-time.ts`). |
| `NODE_ENV` | runtime | `lib/db/index.ts:33` | Standard. Not a secret. |
| `PLAYWRIGHT_TEST` | server-only | `lib/auth/config.ts:41` | Feature-flag for the test-only Credentials provider. MUST be unset in production (and is not on the production env-var allow-list above). Documented separately in the auth checklist. |

## Leakage audit

`grep -rn 'NEXT_PUBLIC_' lib app components scripts` → **no hits**.

All env reads use bracket notation (`process.env["KEY"]`), which is
required by `noUncheckedIndexedAccess: true` and surfaces missing values
as `undefined` rather than silently returning a fallback. Each consumer
either:

- Throws on missing (`lib/db/index.ts`, `lib/slack/client.ts`,
  `scripts/migrate.ts`, `scripts/seed.ts`), or
- Coalesces to a safe sentinel that fails-closed (`lib/auth/config.ts`
  domain check returns `[]` for unset `ALLOWED_EMAIL_DOMAINS`, which
  rejects every sign-in).

## Operator notes

- `.env.local` is gitignored. `.env.example` documents the variable
  names with no values. Never commit a real `.env`.
- When rotating `CRON_SECRET`: update Google Apps Script Bearer header
  AND the server env in the same deploy window. The previous value
  remains valid only as long as the previous deployment runs.
- When rotating `SLACK_BOT_TOKEN`: revoke the old token in Slack admin
  AFTER the new token is live in production, to avoid a window where
  notifications drop silently.
- Phase ≥ 2: ship secrets via a secrets manager (Doppler / Vault /
  AWS Secrets Manager) rather than raw env vars. Tracked as a Phase 2
  improvement.

## Out-of-scope

- Google Workspace tenant-level secrets (Workspace admin password,
  recovery codes) are the root of trust for OAuth sign-in but are not
  managed by this app.
- Slack workspace-level secrets (signing secret for inbound webhooks)
  are NOT used in v1 — there are no inbound Slack events. Reserve the
  variable name `SLACK_SIGNING_SECRET` if events are added later.
