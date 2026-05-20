# Wave 1 security review — middleware, next.config, libs, threat model

**Verdict: APPROVED WITH NITS**

The Wave 1 security drop is comprehensive: middleware matcher,
security headers, sanitiser, constant-time comparator, cycle
detector, CSRF helper, threat model (12 entries), auth checklist,
API checklist, secrets inventory, test-auth threat model. Strong
work. Three issues block a clean approval: (a) CSP allows
`'unsafe-eval'` (dev convenience that should be removed for prod
builds), (b) the sanitiser's URI-scheme neutralisation has a
bypassable edge case, (c) `assertSameOrigin` exists but admin
routes don't call it (cross-link to backend review).

## Middleware (`middleware.ts`)

✓ Matcher excludes `_next/static`, `_next/image`,
`favicon.ico`, `robots.txt`, `sitemap.xml`, `manifest.json`, and a
sane list of static-asset extensions. Public prefixes (`/login`,
`/api/auth`, `/api/cron`, `/favicon.ico`, `/_next`) handled by
`isPublicPath`. Anonymous browser → `/login?callbackUrl=…`.
Anonymous API → `401 {error: "Unauthorized"}`.

✓ `callbackUrl` is built from `pathname + search` only — no host,
no protocol — so the open-redirect surface (Threat T11) is closed
at the middleware layer. The login page still needs to validate
the value starts with `/` and not `//` (open issue carried in the
threat model T11).

🟡 Minor: middleware reads `req.auth?.user` directly. Per the
threat model T5 mitigation comment ("middleware only gates 'is
there any session at all'"), this is fine — but the comment block
should explicitly call out that role checks are not performed
here. Already noted in lines 13-16.

## Next.js config (`next.config.mjs`)

✓ X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-
Policy `strict-origin-when-cross-origin`, Permissions-Policy
clamping camera/microphone/geolocation. CSP includes
`frame-ancestors 'none'` (clickjacking T10).

🟡 `script-src` includes `'unsafe-inline' 'unsafe-eval'` (with
inline-comment justification). For dev the eval token is required
by React Fast Refresh; for prod it should be removed. Either gate
the CSP on `process.env.NODE_ENV === "production"` or migrate to
the experimental nonce-based config NOW so we don't ship
`unsafe-eval` to prod in Phase 7. Currently the same CSP is
emitted for both environments.

🟡 `style-src 'unsafe-inline'` is documented (Radix portals,
Sonner). Acceptable for v1, but worth tracking — moving to
emotion-style cache nonces is a Phase ≥ 2 task.

## sanitize.ts (`lib/security/sanitize.ts`)

✓ Strips `<script>` and `<style>` with whitespace-tolerant regex,
strips inline `on*=` event handlers, HTML-encodes `<`/`>`, drops
NUL bytes, clamps to 5,000 chars.

🟡 URI-scheme rule bypass cases:
   - `JAVASCRIPT&#58;alert(1)` — the colon is HTML-encoded so the
     scheme regex never matches; the HTML encoder runs AFTER, so the
     entity survives and an HTML parser decodes it downstream.
   - `style="background:url(javascript:…)"` — `on*=` rule doesn't
     match `style=`. Theoretical today (we escape all HTML) but the
     sanitiser is the contract for any future allow-HTML sink.
   - **Fix**: HTML-decode entities first OR run the scheme regex
     twice. Ship `tests/unit/sanitize.test.ts` with bypass cases.

## constant-time.ts (`lib/security/constant-time.ts`)

✓ Length-equalises before `timingSafeEqual`, rejects empty inputs
(prevents `""` env coercion attack), copies via Buffer.alloc so
the originals aren't mutated. The final `equal && aBuf.length ===
bBuf.length` AND-chain *does* short-circuit on length — but only
AFTER the equal-length compare runs, so the wall-clock isn't a
side-channel for length.

🟡 The short-circuit at line 21 (`if (aBuf.length === 0 || bBuf.
length === 0) return false`) leaks one bit of timing (presence of
empty string). Acceptable for protecting against config-missing
attacks but worth noting in a comment.

✓ Used at exactly one call site (cron handler) — no other secret
compares exist, which keeps the audit surface minimal.

## cycle-detect.ts (`lib/security/cycle-detect.ts`)

✓ Pure, no DB. Handles self-management (length-0 cycle), pre-
existing cycles in input (treats as cycle), bounded depth
(`MAX_CHAIN_DEPTH = 1_000`).

🟡 Duplicate of `lib/employee/cycle-detect.ts` (Phase 0 finding
#9). Reconcile: the employee version does DB walks, the security
version is pure. CSV import uses
`detectCycleInMemory` from `lib/employee/cycle-detect.ts` and not
`lib/security/cycle-detect.ts`. Either delete the security copy or
make `lib/employee/cycle-detect.ts` re-export it.

## csrf.ts (`lib/security/csrf.ts`)

✓ Origin-then-Referer logic, both checked against `req.url`'s
origin. Returns `null` on pass, 403 NextResponse on fail.

🔴 Cross-link to backend review: `assertSameOrigin` is imported
in 4 routes (`leave`, `wfh`, `notifications/read`) but NOT in any
`/api/admin/**` mutating route. Block on backend until those are
patched.

## Threat model (`docs/security/threat-model.md`)

✓ Twelve entries, STRIDE-tagged, severity-weighted, each
mitigation cross-linked to code. Critical = T2 (IDOR) + T8 (mass-
assignment). The "open issues" list at the bottom of T1, T3, T4,
T9, T11, T12 is the active worklist for Wave 2.

🟡 T9 (CSRF) "Open issue: codify the Origin check in a small
`assertSameOrigin` helper" is already done (in `lib/security/
csrf.ts`); the threat model should be updated to mark it closed
and tighten the open-issue to "admin routes don't use it yet".

🟡 T7 (audit-log tampering) lists the Postgres trigger / RLS as
"Phase 2 improvement". With the FK gap noted in Phase 0 finding
#1, and the nullable `audit_logs.metadata` (Phase 0 #2), this
should be re-graded Medium-bordering-High until those land.

## Secrets inventory + auth checklist

Both docs are well-formed:

- `docs/security/secrets.md` enumerates every env var, classifies
  server-only vs build-only vs public, and confirms zero
  `NEXT_PUBLIC_` leakage via grep.
- `docs/security/auth-checklist.md` grades the seven NextAuth
  callbacks against the threat model and documents the Wave 1
  patches inline. Open issue listed: production-mode assertion
  for `PLAYWRIGHT_TEST !== "1"` when `NODE_ENV === "production"`.
  This SHOULD land in Phase 7 hardening as a boot-time throw.

## Numbered findings

1. **changes** — `next.config.mjs:30`. CSP `'unsafe-eval'` is dev-
   only. Gate the directive on `process.env.NODE_ENV !==
   "production"` or wire the Phase ≥ 2 nonce config now. Phase 7
   hardening at the latest.

2. **changes** — `lib/security/sanitize.ts:56-67`. Order of
   operations means HTML-encoded scheme strings (`javascript&#58;`)
   survive both the scheme regex AND the encoder. Decode entities
   first, OR run the scheme regex twice (before + after encode).
   Either way, ship `tests/unit/sanitize.test.ts` with the bypass
   cases.

3. **changes** — `lib/security/cycle-detect.ts` duplicates
   `lib/employee/cycle-detect.ts`. Consolidate (re-export or
   delete) so callers can't pick the wrong one. Threat model
   T3/T8/T10 mitigations point here.

4. **nit** — `docs/security/threat-model.md` T9 open issue is
   stale; `assertSameOrigin` exists. Tighten to "ensure every
   admin mutation calls it".

5. **nit** — `docs/security/threat-model.md` T7 should be re-
   graded once Phase 0 audit-log nullability is fixed.

6. **praise** — `docs/security/test-auth.md` is the cleanest piece
   of risk documentation in the repo. Three-layer defence
   articulated, code references inline, removal recipe at the
   bottom.

7. **praise** — `docs/security/api-checklist.md`. Ten items, each
   with ✓/✗ phrasing, ready for backend-dev to fill out per
   route. Made the backend review trivially mechanical.

## Summary

| Severity | Count |
| -------- | ----- |
| block    | 0 (CSRF block lives in backend review) |
| changes  | 3 (items 1-3) |
| nit      | 2     |
| praise   | 2     |

Wave 1 security infra is strong. Item 1 (CSP `unsafe-eval`) is the
must-fix before Phase 7 prod; item 2 (sanitiser bypass) is the
must-fix this wave.
