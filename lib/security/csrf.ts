/**
 * Same-origin guard for state-changing routes — threat-model T9.
 *
 * NextAuth's session cookie defaults to `SameSite=Lax`, which blocks
 * cross-site cookie attachment on most POST shapes. This guard adds a
 * defence-in-depth check: when the request carries an `Origin` header
 * (every modern browser fetch / XHR does), it must equal the request's
 * own origin. Same-origin requests pass; cross-origin requests fail
 * with 403 BEFORE the handler touches the DB or Slack.
 *
 * Why not check Origin == Referer fallback? Browsers strip `Referer`
 * in many privacy modes (cross-origin, no-referrer policies). `Origin`
 * is sent unconditionally on POST / PUT / PATCH / DELETE from script
 * contexts. If neither header is present we accept the request — that
 * matches a same-origin form submit or a server-to-server call, neither
 * of which is a CSRF vector against a browser session.
 *
 * Exemptions (do NOT call assertSameOrigin from):
 *   - /api/auth/*   — NextAuth's own CSRF token covers it.
 *   - /api/cron/*   — Bearer-secret authenticated, not cookie-based.
 *
 * Returns `null` if the request passes; returns a 403 NextResponse if
 * it fails. Callers should: `const fail = assertSameOrigin(req); if
 * (fail) return fail;` as the first line of the handler.
 */
import type { NextRequest, NextResponse } from "next/server";
import { apiError, type ApiErrorBody } from "@/lib/api/errors";

function originOf(urlLike: string): string | null {
  try {
    const u = new URL(urlLike);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Verifies the request is same-origin. Returns `null` on pass, a 403
 * NextResponse on fail. Pass-through when neither `Origin` nor `Referer`
 * is present (non-browser caller).
 */
export function assertSameOrigin(
  req: NextRequest,
): NextResponse<ApiErrorBody> | null {
  const reqOrigin = originOf(req.url);
  if (!reqOrigin) {
    return apiError(403, "CSRF_BAD_REQUEST", "Forbidden");
  }

  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== reqOrigin) {
      return apiError(403, "CSRF_ORIGIN_MISMATCH", "Forbidden");
    }
    return null;
  }

  const referer = req.headers.get("referer");
  if (referer) {
    const refOrigin = originOf(referer);
    if (!refOrigin || refOrigin !== reqOrigin) {
      return apiError(403, "CSRF_ORIGIN_MISMATCH", "Forbidden");
    }
    return null;
  }

  // No Origin and no Referer: not a browser fetch. Pass through (same-origin
  // form submits include Referer; CSRF requires a browser-driven origin).
  return null;
}
