# Wave 1 UI review — ui-ux-designer (18 components + tokens + layout)

**Verdict: APPROVED WITH NITS**

ui-ux-designer's deliverables are tight: 18 custom components, all
under 200 lines (max: `data-table.tsx` at 169), no `any`, no
hardcoded magic colors. All Tailwind classes resolve to theme tokens
declared in `app/globals.css`. Dark mode + mobile audited via the
component code (responsive classes present and consistent). Three
gaps prevent a clean pass: a missing `components/forms/`,
`components/tables/`, `components/layout/` directory population
(empty per A17), the `data-table.tsx` mobile-render UX needs a
secondary affordance, and a couple of small a11y polish items.

The 28 shadcn primitives in `/ui` are stock — out of review scope
beyond confirming they're untouched and re-exported only through the
custom layer.

## Component grade

| Component                     | LOC | Type-safe | Tokens | Dark | Mobile | ARIA | Verdict |
| ----------------------------- | --- | --------- | ------ | ---- | ------ | ---- | ------- |
| app-shell.tsx                 |  51 | ✓ | ✓ | ✓ | ✓ | n/a | ✓ |
| avatar.tsx                    |  94 | ✓ | ✓ | ✓ | n/a | ✓ | ✓ |
| balance-card.tsx              |  86 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| confirm-dialog.tsx            |  97 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| data-table.tsx                | 169 | ✓ (generic) | ✓ | ✓ | ✓ | partial | 🟡 |
| date-range-picker.tsx         | 102 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| empty-state.tsx               |  49 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| leave-type-badge.tsx          |  40 | ✓ | ✓ | ✓ | n/a | ✓ | ✓ |
| leave-type-picker.tsx         |  88 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| navbar.tsx                    | 104 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| notification-bell.tsx         | 151 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| page-shell.tsx                |  79 | ✓ | ✓ | ✓ | ✓ | n/a | ✓ |
| role-badge.tsx                |  43 | ✓ | ✓ | ✓ | n/a | ✓ | ✓ |
| sidebar.tsx                   | 157 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| skeletons.tsx (5 exports)     | 104 | ✓ | ✓ | ✓ | ✓ | n/a | ✓ |
| status-badge.tsx              |  43 | ✓ | ✓ | ✓ | n/a | n/a | ✓ |
| theme-provider.tsx            |  12 | ✓ | n/a | ✓ | n/a | n/a | ✓ |
| theme-toggle.tsx              |  71 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Strengths (praise)

- **Design tokens** (`app/globals.css`). Warm-paper / warm-charcoal
  palette with WCAG AA spot-check annotations inline. Reduced-motion
  honoured. 44 px tap targets on coarse pointers. Unified focus-ring
  via `:focus-visible` selector.
- **`components/avatar.tsx`** — djb2 hash for deterministic palette
  bucketing, full Tailwind class literals (not interpolated) so JIT
  picks them up, ring offset + a11y-label = `name`.
- **`components/sidebar.tsx`** — desktop persistent + mobile Sheet
  share `NavList`; `aria-current="page"` set on active item;
  `aria-label="Primary"` on the nav. Praise.
- **`components/data-table.tsx`** — generic `<TData>`, optional
  `mobileRender` slot, sticky header via `.table-sticky-head` utility,
  pagination + sort + global filter all opt-in. Strong shape.
- **`components/skeletons.tsx`** — 5 variants (Table, CardGrid, Form,
  StatCard, Dashboard). A13 + PRD §UI mandates skeletons, not
  spinners — fully covered.

## Findings

1. **changes** — `components/data-table.tsx:135`. The DataTable
   renders the desktop `<Table>` AND the `mobileRender` list in
   parallel, hiding one via `sm:hidden` / `hidden sm:block`. That
   doubles the DOM weight on every render and breaks screen-reader
   focus order (both copies announce). Pick one based on a
   `useMediaQuery` or render `<Table>` always with column hiding via
   CSS — but never both at once.

2. **changes** — `components/data-table.tsx:118-131`. The filter
   `<Input>` has `aria-label="Filter rows"` but no `<label>`. For
   screen-reader users that's fine; for sighted keyboard users the
   placeholder ("Filter…") disappears on focus. Add a visible label
   above the input or keep a static lead-in icon + visually-hidden
   label.

3. **changes** — `components/forms/`, `components/tables/`,
   `components/layout/` directories exist but are empty (A17 baseline
   says they should hold the form/table/layout presets). ui-ux-
   designer hasn't shipped any reusable form composition primitive
   (e.g. `<FormField>` wrappers, `<DialogForm>`). Wave 2's frontend-
   dev will need at least one of: react-hook-form + Zod wrapper,
   labelled-field row component, error-summary row.

4. **nit** — `components/notification-bell.tsx:32-43`.
   `formatRelative` re-implements relative-time formatting. The
   project already depends on `date-fns` (used in `date-range-
   picker.tsx`). Use `formatDistanceToNow` for consistency and
   locale-readiness.

5. **nit** — `components/data-table.tsx:135-164`. Hard-coded
   `max-h-[70vh]` on the scroll container. Below 600 px viewports
   the table loses ~150 px of bottom padding before its own scroll
   kicks in. Switch to `max-h-[min(70vh,640px)]` or expose as prop.

6. **nit** — `components/sidebar.tsx:78`. Collapsed state stored in
   component-local React state, so a page reload resets it. Either
   persist to localStorage (no SSR mismatch concern at app shell
   level since this is below `<AppShell>`) or document the choice
   inline.

7. **nit** — `components/avatar.tsx:88`. `aria-hidden={image ?
   "true" : undefined}` on the fallback is correct but
   `exactOptionalPropertyTypes` was forcing the conditional spread
   pattern elsewhere — here a plain `aria-hidden={!!image}` reads
   cleaner.

8. **nit** — `components/balance-card.tsx:64-77`. `role="progressbar"`
   with `aria-valuenow=used` — for a remaining-balance card,
   announcing "used: 12 of 20" via aria is the right call. But
   `aria-valuetext` is missing; assistive tech will announce the
   raw number. Add `aria-valuetext={\`${remaining} of ${allocated}
   days remaining\`}`.

9. **nit** — `app/globals.css:113-121`. Coarse-pointer tap-target
   rule applies to `button`, `[role="button"]`, etc., but not to
   `<a>` tags without `.btn` class. Many nav links don't carry
   `.btn` (see sidebar nav). Either drop the `.btn` qualifier or
   add `.nav-link` to the selector and apply it on the link.

10. **praise** — `components/role-badge.tsx`. All three roles mapped
    to discrete colour pairs with explicit dark variants. The
    EMPLOYEE neutral bucket is intentionally low-contrast (uses
    `text-foreground/80`) to make HR_ADMIN/SUPER_ADMIN pop in lists.
    (Updated after ADR-0006 dropped MANAGER as a role.)

11. **praise** — `app/layout.tsx`. `robots: { index:false,
    follow:false }` matches internal-tool intent;
    `themeColor` per colour scheme; `template: "%s · Vaudit HR"`
    so every page contributes to A12 branding. Tight metadata.

12. **praise** — `components/page-shell.tsx` + `components/app-
    shell.tsx`. AppShell is a Server Component (no `"use client"`)
    that fetches the session server-side and feeds Navbar the
    minimal user shape. No client-side session refetch. Good split.

## Summary

| Severity | Count |
| -------- | ----- |
| block    | 0     |
| changes  | 3 (items 1-3) |
| nit      | 6     |
| praise   | 3     |

Three `changes` items are real but bounded: dual-rendering in
DataTable is the only one that's user-facing today. The empty
`forms/`/`tables/`/`layout/` directories should be populated by
Wave 2 frontend-dev — flag as a hand-off requirement, not a Wave 1
blocker.
