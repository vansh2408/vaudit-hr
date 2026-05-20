import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for Vaudit HR.
 *
 * - happy-dom for fast DOM polyfills (RHF/Testing Library).
 * - Path alias `@` matches the Next.js tsconfig `paths`.
 * - Coverage is informational only (decisions.md A13 — no % gate in v1).
 * - setupFiles runs once per worker: TZ=UTC + jest-dom matchers + global stubs.
 * - testTimeout 10s gives DB-tx fixtures room without masking real hangs.
 */
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "tests/e2e/**", ".next", "playwright-report"],
    setupFiles: ["tests/unit/setup.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["lib/**/*.ts", "app/**/*.ts", "app/**/*.tsx"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "**/*.spec.ts",
        "lib/db/migrations/**",
        "tests/**",
      ],
      // A13: no thresholds in v1, coverage is informational only.
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
