/**
 * Approver-recipient fanout for leave + WFH events.
 *
 * Per the 2026-05-19 policy decision (option B): every "request event"
 * notification (submit, edit, cancel-request) fans out to:
 *   - The requester's direct manager (if any).
 *   - ALL active HR_ADMIN and SUPER_ADMIN users.
 *
 * Minus the requester themselves so we never self-DM. Deduped by id so a
 * manager who is also an HR admin still gets exactly one Slack DM + one
 * in-app row. The "manager first" insertion order is a stable convention
 * so reading audit / logs preserves the intuitive order.
 *
 * Rationale: a notification policy that only DMs the manager silently
 * loses the request when (a) the employee has no manager assigned or
 * (b) the manager is offline / on leave themselves. HR is the operational
 * fallback. For organisations with a high request volume this can be
 * downgraded to "manager + HR fallback when no manager" — see decisions
 * A23 follow-up.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as defaultDb } from "@/lib/db";
import type { schema as dbSchema } from "@/lib/db";
import { users } from "@/lib/db/schema";

type Db = NodePgDatabase<typeof dbSchema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export interface ApproverRecipient {
  id: string;
  slackUserId: string | null;
}

export async function getApproverRecipients(
  requesterId: string,
  managerId: string | null,
  client: DbOrTx = defaultDb,
): Promise<ApproverRecipient[]> {
  // Pull all active admins in one query; if the manager is among them
  // (or is anyone else), the Map dedup keeps a single entry.
  const admins = await client
    .select({ id: users.id, slackUserId: users.slackUserId })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        inArray(users.role, ["HR_ADMIN", "SUPER_ADMIN"]),
        ne(users.id, requesterId),
      ),
    );

  const byId = new Map<string, ApproverRecipient>();
  // Manager first so the iteration order is stable (and reading the list
  // in logs feels like "manager + admins" rather than "admins maybe and
  // manager somewhere").
  if (managerId && managerId !== requesterId) {
    const mgr = await client
      .select({ id: users.id, slackUserId: users.slackUserId })
      .from(users)
      .where(eq(users.id, managerId))
      .limit(1);
    const m = mgr[0];
    if (m) byId.set(m.id, m);
  }
  for (const a of admins) {
    if (!byId.has(a.id)) byId.set(a.id, a);
  }
  return [...byId.values()];
}
