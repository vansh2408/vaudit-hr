# ADR-0002: Authentication flow

- Status: Accepted
- Date: 2026-05-12
- Deciders: Architect, Security

## Context

We need authentication for an internal HR app. The user population is
known (HR onboards everyone), email domains are constrained (`vaudit.com`,
`blokid.com`), and we want to keep the auth boundary small and easy to
reason about. NextAuth v5 is the framework default; Google OAuth is the
identity source the company already uses.

decisions.md A15 ratifies: pre-staged user rows + email-link on first
sign-in + merged `users` table (NextAuth fields + HR fields in one row).

## Decision

1. **Pre-staging.** HR creates the user row in the `users` table before
   the employee first signs in. No password flow exists.
2. **Provider.** Google OAuth only.
3. **Domain restriction.** The `signIn` callback parses the email,
   normalises the domain to lowercase, and rejects if it is not in the
   `ALLOWED_EMAIL_DOMAINS` env list.
4. **Row lookup.** The callback then looks up `users` by email. If no
   row exists, sign-in is refused; the UI surfaces a generic "Your
   account hasn't been set up yet, contact HR" message.
5. **Account linking.** `allowDangerousEmailAccountLinking: true` is set
   on the Google provider so the OAuth identity binds to the existing
   HR-staged row by email. Safe here because (a) the domain whitelist
   is enforced first, (b) there is no password account that could be
   silently linked, and (c) HR controls the canonical email mapping.
6. **Session strategy.** Database sessions, not JWT. The session
   callback re-reads role + identity from Postgres every call so a
   role change takes effect on the next request without forcing a
   re-login.
7. **Audit log.** First-time link writes an `auth.first_link` row to
   `audit_logs`; Slack/audit failures must not block sign-in.

## Consequences

- Zero password surface area.
- No "self-signup" branch — onboarding requires HR action, which matches
  the company process.
- Role changes propagate instantly because we never cache role in the
  session token.
- Database round-trip on every session resolution; acceptable at our
  scale and avoids the JWT-staleness class of bugs.
- We pay the `allowDangerousEmailAccountLinking` warning in the
  NextAuth docs; ADR documents why it is acceptable.

## Alternatives considered

- **JWT session strategy** — faster but caches role; would need a
  manual invalidation path. Not worth the complexity at ~50 users.
- **Magic-link email** — extra channel to manage, slower onboarding,
  no SSO badge.
- **Separate `employees` and NextAuth `users` tables** — two-row
  truth, requires manual reconciliation on every NextAuth event. The
  merged-row decision (A15) eliminates that drift entirely.
