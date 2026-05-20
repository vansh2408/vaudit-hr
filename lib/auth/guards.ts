/**
 * Auth guards — to be called at the top of every protected Route Handler
 * and Server Action.
 */
import { auth } from "./config";
import type { Session } from "next-auth";
import type { UserRole } from "@/lib/db/schema";

export class UnauthorizedError extends Error {
  override readonly name = "UnauthorizedError";
  constructor(message = "Not authenticated") {
    super(message);
  }
}

export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  constructor(message = "Insufficient permissions") {
    super(message);
  }
}

/** Returns the current session or throws UnauthorizedError. */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  return session;
}

/** Returns the session if the user has one of the allowed roles. */
export async function requireRole(
  ...allowedRoles: readonly UserRole[]
): Promise<Session> {
  const session = await requireSession();
  if (!allowedRoles.includes(session.user.role)) {
    throw new ForbiddenError(
      `Role ${session.user.role} not in [${allowedRoles.join(", ")}]`,
    );
  }
  return session;
}

/** Convenience: HR-tier guards (HR_ADMIN + SUPER_ADMIN). */
export function requireAdmin(): Promise<Session> {
  return requireRole("HR_ADMIN", "SUPER_ADMIN");
}

/**
 * Anyone who can approve at least one other person's request: admins, OR
 * users with at least one direct report (i.e. someone's manager_id points
 * at them). Replaces the old `requireRole("MANAGER", "HR_ADMIN", ...)`
 * pattern now that MANAGER is no longer a role.
 */
export async function requireManagerOrAdmin(): Promise<Session> {
  const session = await requireSession();
  const role = session.user.role;
  if (role === "HR_ADMIN" || role === "SUPER_ADMIN") return session;
  if (session.user.isManager) return session;
  throw new ForbiddenError(
    "Only managers and HR can perform this action",
  );
}
