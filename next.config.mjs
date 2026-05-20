/** @type {import('next').NextConfig} */

/**
 * Content-Security-Policy.
 *
 * Relaxations from a strict default-src 'self' baseline, and why:
 *   - script-src 'unsafe-inline'
 *       Next.js 14 App Router still emits inline bootstrap scripts.
 *       Tighten later via a nonce once we migrate to the experimental
 *       nonce-based config.
 *   - script-src 'unsafe-eval' — DEV ONLY
 *       React Fast Refresh + Next.js dev overlay rely on eval. The
 *       production bundle does not need it, so we drop it in `next build`
 *       output. This is the threat-model T8 mitigation (see
 *       docs/reviews/cross-cutting.md item 9). Keep the branch — do NOT
 *       collapse it back to a single constant.
 *   - style-src 'unsafe-inline'
 *       Tailwind + shadcn/ui inject style attributes (Radix portals,
 *       Sonner toasts). Required for the current UI to render.
 *   - https://apis.google.com + https://accounts.google.com
 *       Google OAuth flow loads scripts/frames from these origins.
 *   - img-src https://lh3.googleusercontent.com data:
 *       Google profile photos + base64 inline avatars.
 *   - connect-src https://slack.com
 *       Server only calls Slack, but the directive is kept tight so any
 *       accidental client-side fetch is allowlisted explicitly.
 *   - frame-src https://accounts.google.com
 *       Required for OAuth consent screen embedding.
 *
 * X-Frame-Options is also set to DENY in case CSP frame-ancestors is
 * stripped by an intermediary; older browsers still honour XFO.
 */
const isDev = process.env.NODE_ENV !== "production";

const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://accounts.google.com"
  : "'self' 'unsafe-inline' https://apis.google.com https://accounts.google.com";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com https://slack.com",
  "frame-src 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self' https://accounts.google.com",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    // Keep `pg` (node-postgres) out of the bundle. Without this, Next tries
    // to bundle pg's optional `pg-native` import and the Edge middleware
    // attempts to load Node's `crypto`. Both fail. The middleware uses the
    // separate edge-only auth config in /lib/auth/edge.ts, so the actual
    // pg import only lives in API routes / server components, where this
    // flag keeps it as a runtime require() rather than a webpack bundle.
    serverComponentsExternalPackages: ["pg"],
  },
  // Silence the harmless "Module not found: pg-native" warning. pg only
  // requires it lazily for an opt-in native binding we don't use.
  webpack: (config) => {
    config.externals = config.externals ?? [];
    if (Array.isArray(config.externals)) {
      config.externals.push("pg-native");
    }
    return config;
  },
  async headers() {
    return [
      {
        // Apply to every route; per-route overrides can be layered later.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
