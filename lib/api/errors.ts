/**
 * Centralized API error helper.
 *
 * Returns a NextResponse with a stable `{ error: { code, message } }` shape.
 * Routes use these so we never leak internal stack traces or PII of other
 * users in error bodies. Codes are stable strings the UI can switch on.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/guards";

/**
 * Thrown by domain helpers (cancel flows, review flows) when the row's
 * current status disagrees with the action's preconditions — e.g. the
 * user clicks "Withdraw cancellation" but the manager has meanwhile
 * rejected the cancellation, so the row is back to APPROVED.
 *
 * handleRouteError maps this to a 409 with code BAD_STATE so the UI can
 * detect it, show a friendly message, and `router.refresh()` to pick up
 * the new state. Without this, a plain Error throw cascaded to a generic
 * 500 — the user-hostile "something exploded" page.
 */
export class BadStateError extends Error {
  override readonly name = "BadStateError";
  constructor(message: string) {
    super(message);
  }
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
  return NextResponse.json(body, { status });
}

/**
 * Maps a thrown error to a stable HTTP response. Use in every route's
 * top-level try/catch so error formatting is consistent.
 */
export function handleRouteError(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof UnauthorizedError) {
    return apiError(401, "UNAUTHORIZED", "Not authenticated");
  }
  if (err instanceof ForbiddenError) {
    return apiError(403, "FORBIDDEN", "Insufficient permissions");
  }
  if (err instanceof BadStateError) {
    return apiError(409, "BAD_STATE", err.message);
  }
  if (err instanceof ZodError) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body", {
      issues: err.issues.map((i) => ({
        path: i.path,
        message: i.message,
        code: i.code,
      })),
    });
  }
  if (err instanceof SyntaxError) {
    return apiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
  // Generic — never leak internals.
  return apiError(500, "INTERNAL_ERROR", "Internal server error");
}
