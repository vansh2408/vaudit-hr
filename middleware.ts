/**
 * Vaudit HR — Edge middleware.
 *
 * Runs before every matched request. Responsibilities:
 *  1. Allow a small, explicit set of public paths through unauthenticated:
 *     /login, /api/auth/*, /api/cron/*, /favicon.ico, /_next/*.
 *  2. For every other request, ensure a NextAuth session cookie is present.
 *     Missing cookie redirects browsers to /login and returns 401 JSON to
 *     API callers.
 *  3. Never run on static assets (matcher excludes _next + common static
 *     file extensions).
 *
 * Why cookie-presence and not full session validation:
 * NextAuth v5 with `session.strategy: "database"` stores only an opaque
 * session ID in the cookie. Validating it requires the Drizzle adapter,
 * which transitively imports `pg` and Node's `crypto` — both unavailable
 * in the Edge runtime. The middleware therefore acts as a UX-level gate
 * only; the real security boundary is server-side, where `requireSession()`
 * / `requireRole()` in API routes and server components hit the DB via the
 * full `auth()` from /lib/auth/config.ts. A forged or stale cookie passes
 * the middleware but fails immediately at the next server-side check, so
 * no data is leaked.
 */
import { NextResponse, type NextRequest } from "next/server";

// Paths that must be reachable without a session. Anything starting with
// these prefixes is allowed through. Keep this list deliberately tiny.
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth", // NextAuth handler (sign-in, callback, csrf, session)
  "/api/cron", // Cron endpoints (auth via CRON_SECRET, not session)
  "/favicon.ico",
  "/_next",
];

// NextAuth v5 cookie names. Dev uses the unprefixed form; production over
// HTTPS uses the `__Secure-` prefix.
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function isPublicPath(pathname: string): boolean {
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function hasSessionCookie(req: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    const c = req.cookies.get(name);
    if (c && c.value) return true;
  }
  return false;
}

export default function middleware(req: NextRequest): NextResponse {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (hasSessionCookie(req)) {
    return NextResponse.next();
  }

  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Browser flow: bounce to login, remembering where we wanted to go.
  const loginUrl = new URL("/login", nextUrl);
  const callback = `${pathname}${nextUrl.search}`;
  if (callback && callback !== "/") {
    loginUrl.searchParams.set("callbackUrl", callback);
  }
  return NextResponse.redirect(loginUrl);
}

// Matcher: run on everything except Next internals and static asset files.
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static (build assets)
     *  - _next/image (image optimizer)
     *  - favicon, robots, sitemap, manifest
     *  - any file with a static asset extension
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.json|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff|woff2|ttf|otf|eot)$).*)",
  ],
};
