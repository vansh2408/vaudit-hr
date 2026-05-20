/**
 * Tests for `apiError` + `handleRouteError`.
 *
 * Every route's top-level try/catch funnels through `handleRouteError` so
 * we never leak internal stacks. These tests pin the mapping:
 *   - Zod → 400 with field details
 *   - Unauthorized → 401 (generic message)
 *   - Forbidden → 403 (generic)
 *   - SyntaxError (bad JSON) → 400
 *   - anything else → 500 (generic — must not leak internals)
 *
 * We construct synthetic errors rather than driving full requests so the
 * test is hermetic and fast.
 *
 * NOTE: `@/lib/api/errors` transitively imports `@/lib/auth/guards`,
 * which in turn imports `next-auth` + the global `db`. We `vi.mock` the
 * auth config so the chain stops at a thin stub — guards.ts itself still
 * loads, exporting the real `UnauthorizedError` / `ForbiddenError`
 * classes that the error helper maps against.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Stub out next-auth's `auth` callable so importing guards.ts doesn't
// trigger the next-auth + DrizzleAdapter + global-db load chain. The
// error classes we test live in guards.ts itself, not in config.ts.
vi.mock("@/lib/auth/config", () => ({
  auth: async () => null,
  handlers: {},
  signIn: () => undefined,
  signOut: () => undefined,
  authConfig: {},
}));

import { apiError, handleRouteError } from "@/lib/api/errors";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/guards";

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

async function readBody(res: Response): Promise<ApiErrorBody> {
  const json = (await res.json()) as ApiErrorBody;
  return json;
}

describe("apiError", () => {
  it("returns a NextResponse with the given status + body shape", async () => {
    const res = apiError(404, "NOT_FOUND", "Employee not found");
    expect(res.status).toBe(404);
    const body = await readBody(res);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Employee not found");
    expect(body.error.details).toBeUndefined();
  });

  it("includes details when supplied", async () => {
    const res = apiError(400, "BAD_INPUT", "missing field", {
      field: "email",
    });
    expect(res.status).toBe(400);
    const body = await readBody(res);
    expect(body.error.details).toEqual({ field: "email" });
  });
});

describe("handleRouteError", () => {
  it("maps ZodError to 400 with VALIDATION_ERROR and issue path/message", async () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().int().min(18),
    });
    const result = schema.safeParse({ email: "not-an-email", age: 12 });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("schema unexpectedly succeeded");

    const res = handleRouteError(result.error);
    expect(res.status).toBe(400);
    const body = await readBody(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Invalid request body");
    // details.issues is an array with at least one entry per failure.
    const details = body.error.details as {
      issues: ReadonlyArray<{
        path: ReadonlyArray<string | number>;
        message: string;
        code: string;
      }>;
    };
    expect(Array.isArray(details.issues)).toBe(true);
    expect(details.issues.length).toBeGreaterThanOrEqual(2);
    const paths = details.issues.map((i) => i.path.join("."));
    expect(paths).toContain("email");
    expect(paths).toContain("age");
  });

  it("maps UnauthorizedError to 401 with a generic message", async () => {
    const res = handleRouteError(new UnauthorizedError("internal detail"));
    expect(res.status).toBe(401);
    const body = await readBody(res);
    expect(body.error.code).toBe("UNAUTHORIZED");
    // Generic copy — must NOT leak the constructor message we passed in.
    expect(body.error.message).toBe("Not authenticated");
    expect(body.error.message).not.toContain("internal detail");
  });

  it("maps ForbiddenError to 403 with a generic message", async () => {
    const res = handleRouteError(
      new ForbiddenError("Role EMPLOYEE not in [HR_ADMIN]"),
    );
    expect(res.status).toBe(403);
    const body = await readBody(res);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("Insufficient permissions");
    expect(body.error.message).not.toContain("EMPLOYEE");
  });

  it("maps SyntaxError (bad JSON) to 400 with INVALID_JSON", async () => {
    const res = handleRouteError(new SyntaxError("Unexpected token } in JSON"));
    expect(res.status).toBe(400);
    const body = await readBody(res);
    expect(body.error.code).toBe("INVALID_JSON");
    expect(body.error.message).toBe("Request body is not valid JSON");
    // The native message must not be echoed.
    expect(body.error.message).not.toContain("Unexpected token");
  });

  it("maps an unknown error to 500 INTERNAL_ERROR without leaking internals", async () => {
    const res = handleRouteError(
      new Error("DB exploded: connection string redacted"),
    );
    expect(res.status).toBe(500);
    const body = await readBody(res);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.message).not.toContain("DB");
    expect(body.error.message).not.toContain("connection");
  });

  it("maps a non-Error throwable (e.g. a string) to 500 too", async () => {
    // Routes sometimes throw bare strings or numbers. These must not crash
    // the handler; they should funnel to the generic 500.
    const res = handleRouteError("boom" as unknown);
    expect(res.status).toBe(500);
    const body = await readBody(res);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
