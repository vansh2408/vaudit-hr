# Login `callbackUrl` validation — TODO for frontend-dev

Threat reference: `docs/security/threat-model.md` T11 (open redirect).

## Status (Wave 2 audit)

The login UI is still a Phase 0 placeholder at
`/app/(auth)/login/page.tsx` — it renders "Sign-in UI lands in Phase 1"
and never reads `searchParams.callbackUrl`. There is therefore **no
exploitable open-redirect surface today**: the middleware writes
`?callbackUrl=<relative path>` only, and the placeholder login page
ignores it.

The middleware already restricts the value it writes to `pathname + search`
(relative-only) — see `/middleware.ts` lines 63-68. The threat surface
opens up the moment the real Phase-1 login page starts honouring
`callbackUrl` for a `signIn(..., { callbackUrl })` call or a manual
`router.push(callbackUrl)` after NextAuth completes.

## Rule for the Phase-1 login page

When the frontend-dev builds the real login page, the `callbackUrl`
search-param **must** be validated before it is forwarded to NextAuth
or used in a client-side redirect. The validation is intentionally
strict because the field is fully attacker-controlled.

Reject the `callbackUrl` (fall back to `/dashboard`) when **any** of
the following hold:

1. The value is missing or empty.
2. The value does **not** start with `/`.
3. The value contains `//` anywhere (catches protocol-relative
   `//evil.example`, scheme-confused `/\\evil.example`, and embedded
   double-slash payloads).
4. The value contains `\` (backslash — IE/Edge legacy parsing quirks
   treat `\` as `/` in URL paths).
5. The decoded form fails the same three checks (defend against
   double-encoded `%2F%2Fevil.example`).

Suggested helper:

```ts
// /lib/auth/callback-url.ts (to be created in Phase 1)
export function safeCallbackUrl(raw: string | null | undefined): string {
  const FALLBACK = "/dashboard";
  if (!raw || typeof raw !== "string") return FALLBACK;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return FALLBACK;
  }
  for (const candidate of [raw, decoded]) {
    if (!candidate.startsWith("/")) return FALLBACK;
    if (candidate.includes("//")) return FALLBACK;
    if (candidate.includes("\\")) return FALLBACK;
  }
  return raw;
}
```

The login page then calls:

```ts
const cb = safeCallbackUrl(searchParams.get("callbackUrl"));
await signIn("google", { callbackUrl: cb });
```

## Tests

Phase-1 should add the following Vitest cases (`tests/unit/`):

- empty / null → `/dashboard`
- `"/dashboard"` → `/dashboard`
- `"/leave/new"` → `/leave/new`
- `"//evil.example/path"` → `/dashboard`
- `"https://evil.example/path"` → `/dashboard` (does not start with `/`)
- `"/\\evil.example/path"` → `/dashboard` (contains `\`)
- `"/%2F%2Fevil.example"` → `/dashboard` (decoded contains `//`)

## Owner

Frontend-dev / Phase-1 login builder. Surface this doc when scoping the
login UI ticket. Security agent re-audits in Wave 3 after the real page
lands.
