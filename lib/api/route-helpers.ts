/**
 * Small helpers shared across Route Handlers.
 *
 * `isAdminRole` is the only role predicate we need now that MANAGER is
 * not a role. "Can approve" checks live next to the session (which
 * carries `isManager` derived from the org chart) — see
 * `requireManagerOrAdmin` in lib/auth/guards.ts.
 */
import type { z } from "zod";
import type { UserRole } from "@/lib/db/schema";

export function parseSearchParams<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
): z.infer<S> {
  const sp = new URL(url).searchParams;
  const obj: Record<string, string> = {};
  for (const [k, v] of sp.entries()) obj[k] = v;
  return schema.parse(obj);
}

export function isAdminRole(role: UserRole): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN";
}
