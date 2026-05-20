/**
 * Thin fetch wrapper used by every client query/mutation.
 *
 * - Sends + accepts JSON
 * - Includes credentials (NextAuth session cookie on same origin)
 * - Throws a structured `ApiError` on non-2xx, parsed from the
 *   `{ error: { code, message, details? } }` envelope the API returns.
 *
 * Server components hit the DB directly; only client components and
 * TanStack Query call sites use this.
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: JsonValue | unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function isErrorEnvelope(
  v: unknown,
): v is { error: ApiErrorPayload } {
  if (typeof v !== "object" || v === null) return false;
  const err = (v as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  const message = (err as { message?: unknown }).message;
  return typeof code === "string" && typeof message === "string";
}

/** Type-narrowed JSON fetch. Throws ApiError on non-2xx responses. */
export async function apiFetch<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const { method = "GET", body, headers, signal } = init;

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(headers ?? {}),
  };

  const res = await fetch(path, {
    method,
    headers: finalHeaders,
    credentials: "same-origin",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal !== undefined ? { signal } : {}),
  });

  // 204 No Content / empty body
  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!res.ok) {
    if (isJson) {
      const payload: unknown = await res.json().catch(() => null);
      if (isErrorEnvelope(payload)) {
        throw new ApiError(res.status, payload.error);
      }
    }
    throw new ApiError(res.status, {
      code: "HTTP_ERROR",
      message: `Request failed with status ${res.status}`,
    });
  }

  if (!isJson) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/** Builds a `?a=b&c=d` query string skipping nullish/empty values. */
export function buildQuery(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : "";
}
