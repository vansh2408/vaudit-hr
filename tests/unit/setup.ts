/**
 * Vitest global setup — runs once per worker before any test file.
 *
 * - Force TZ=America/Los_Angeles (UTC-8/-7) so date math runs in a non-UTC,
 *   west-of-UTC timezone. This deliberately surfaces calendar-date-as-instant
 *   TZ bugs that are invisible when tests run under UTC. The previous setup
 *   pinned TZ=UTC, which masked a class of date-shift bugs in production —
 *   never go back to UTC here.
 * - Add jest-dom matchers (`toBeInTheDocument`, etc.) to expect().
 * - Polyfill TextEncoder/TextDecoder and ResizeObserver for happy-dom so
 *   React + RHF + shadcn primitives don't crash in unit tests.
 */
process.env["TZ"] = "America/Los_Angeles";

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";

// ---- TextEncoder / TextDecoder ----
// happy-dom usually provides these, but some Node 20 minor versions don't
// expose them on globalThis. Backfill from `node:util` if missing.
// lib.dom and node:util disagree on the strict signature, but at runtime
// they are interchangeable — both speak the WHATWG Encoding spec — so we
// route the assignment through a single `unknown` cast rather than `any`.
import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from "node:util";

const globalSlot = globalThis as unknown as Record<string, unknown>;
if (typeof globalSlot["TextEncoder"] === "undefined") {
  globalSlot["TextEncoder"] = NodeTextEncoder;
}
if (typeof globalSlot["TextDecoder"] === "undefined") {
  globalSlot["TextDecoder"] = NodeTextDecoder;
}

// ---- ResizeObserver no-op ----
// shadcn/Radix components call ResizeObserver on mount; happy-dom does not
// implement it. A no-op stub is enough — tests don't assert on layout.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type GlobalWithObservers = typeof globalThis & {
  ResizeObserver?: typeof ResizeObserverStub;
};

const og = globalThis as GlobalWithObservers;
if (typeof og.ResizeObserver === "undefined") {
  og.ResizeObserver = ResizeObserverStub;
}

beforeAll(() => {
  // Sanity assert — fail loudly if TZ wasn't honored. We expect a non-zero
  // offset (i.e. not UTC) so that calendar-date-as-instant bugs surface.
  const offset = new Date().getTimezoneOffset();
  if (offset === 0) {
    throw new Error(
      `Expected non-UTC TZ but got UTC (offset 0). ` +
        "Tests must run in a non-UTC zone to catch date-shift bugs.",
    );
  }
});

afterEach(() => {
  cleanup();
});
