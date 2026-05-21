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
 * handleRouteError maps this to a 409 with the carried `code` so the UI
 * can switch on it. The default code BAD_STATE means "the row drifted
 * under you, refresh and retry" — the UI handles this by quietly
 * refetching. Subclasses / explicit codes (e.g. PAST_LEAVE_LOCK) cover
 * business-rule rejections where refreshing won't help and the user
 * needs to see the actual reason.
 */
export class BadStateError extends Error {
  override readonly name = "BadStateError";
  readonly code: string;
  constructor(message: string, code: string = "BAD_STATE") {
    super(message);
    this.code = code;
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
    return apiError(409, err.code, err.message);
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
