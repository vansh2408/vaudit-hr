/**
 * Single entry point for writing audit log rows.
 * Phase 0 stub — extended in Phase 2 with bulk + query helpers.
 */
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export interface AuditLogInput {
  actorId: string | null;
  action: string;
  targetTable: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: input.actorId,
    action: input.action,
    targetTable: input.targetTable,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
  });
}
