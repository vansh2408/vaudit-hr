/**
 * Shared Zod refinements used across forms + API routes.
 *
 * Schemas are intentionally permissive on inputs (trim, toLowerCase) and
 * strict on outputs (regex-validated). Reuse drizzle-zod generated schemas
 * where possible and pick the fields each route actually accepts.
 */
import { z } from "zod";
import {
  insertHolidaySchema,
  insertLeaveBalanceSchema,
} from "@/lib/db/schema";
import { parseYmd, type Ymd } from "@/lib/utils/dates";

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .email()
  .transform((v) => v.toLowerCase());

export const birthdayYmdSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    "Expected YYYY-MM-DD",
  );

export const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{6})$/, "Expected #RRGGBB hex color");

export const userRoleSchema = z.enum([
  "EMPLOYEE",
  "HR_ADMIN",
  "SUPER_ADMIN",
]);

export const requestStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);

/**
 * Calendar date schema — outputs a branded Ymd ("YYYY-MM-DD") string,
 * never a JS Date. Use this for everything that represents a *day*
 * (leave dates, birthdays, holidays). See lib/utils/dates.ts.
 *
 * Validation is done via parseYmd which checks the calendar is real
 * (rejects 2026-02-30 etc).
 */
export const dateFromYmdSchema = z
  .string()
  .transform((s, ctx): Ymd => {
    try {
      return parseYmd(s);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : "Invalid YYYY-MM-DD",
      });
      return z.NEVER;
    }
  });

const uuidSchema = z.string().uuid();

// ---------- Half-day ----------
// Slot enum mirrors the DB CHECK constraint (chk_leave_half_day /
// chk_wfh_half_day) added in migration 0006. The UI labels these as
// "Morning" / "Afternoon"; the DB stays neutral.
export const halfDaySlotSchema = z.enum(["FIRST_HALF", "SECOND_HALF"]);

// Cross-field invariants applied via .superRefine on each request schema:
//   1. isHalfDay = true  ⇒ halfDaySlot must be set
//   2. isHalfDay = false ⇒ halfDaySlot must be undefined/null
//   3. isHalfDay = true  ⇒ startDate === endDate (single date only in V1)
// Kept as a plain function (not a helper wrapping ZodEffects) so the per-
// schema generic shape is preserved through the chain.
function checkHalfDayInvariants(
  v: {
    isHalfDay: boolean;
    halfDaySlot?: "FIRST_HALF" | "SECOND_HALF" | null | undefined;
    startDate: Ymd;
    endDate: Ymd;
  },
  ctx: z.RefinementCtx,
): void {
  if (v.isHalfDay) {
    if (!v.halfDaySlot) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["halfDaySlot"],
        message: "halfDaySlot is required when isHalfDay is true",
      });
    }
    if (v.startDate !== v.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Half-day requests must be a single date",
      });
    }
  } else if (v.halfDaySlot != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["halfDaySlot"],
      message: "halfDaySlot must be null when isHalfDay is false",
    });
  }
}

// ---------- Leave ----------
export const leaveRequestCreateSchema = z
  .object({
    leaveTypeId: uuidSchema,
    startDate: dateFromYmdSchema,
    endDate: dateFromYmdSchema,
    reason: z.string().trim().max(2000).optional(),
    isHalfDay: z.boolean().default(false),
    halfDaySlot: halfDaySlotSchema.nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  })
  .superRefine(checkHalfDayInvariants);

export const leaveRequestReviewSchema = z.object({
  // APPROVE_CANCEL / REJECT_CANCEL act on a request in PENDING_CANCELLATION;
  // APPROVE / REJECT act on a PENDING request. WITHDRAW_CANCEL is the
  // owner-only undo for a still-pending cancellation request.
  action: z.enum([
    "APPROVE",
    "REJECT",
    "APPROVE_CANCEL",
    "REJECT_CANCEL",
    "WITHDRAW_CANCEL",
  ]),
  reviewerNote: z.string().trim().max(2000).optional(),
});

// Edit-in-place for PENDING requests by the original requester.
// Mirrors the create schema; the route checks ownership + status.
export const leaveRequestEditSchema = z
  .object({
    action: z.literal("EDIT"),
    leaveTypeId: uuidSchema,
    startDate: dateFromYmdSchema,
    endDate: dateFromYmdSchema,
    reason: z.string().trim().max(2000).optional(),
    isHalfDay: z.boolean().default(false),
    halfDaySlot: halfDaySlotSchema.nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  })
  .superRefine(checkHalfDayInvariants);

// ---------- WFH ----------
export const wfhRequestCreateSchema = z
  .object({
    startDate: dateFromYmdSchema,
    endDate: dateFromYmdSchema,
    reason: z.string().trim().max(2000).optional(),
    isHalfDay: z.boolean().default(false),
    halfDaySlot: halfDaySlotSchema.nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  })
  .superRefine(checkHalfDayInvariants);

export const wfhRequestReviewSchema = leaveRequestReviewSchema;

export const wfhRequestEditSchema = z
  .object({
    action: z.literal("EDIT"),
    startDate: dateFromYmdSchema,
    endDate: dateFromYmdSchema,
    reason: z.string().trim().max(2000).optional(),
    isHalfDay: z.boolean().default(false),
    halfDaySlot: halfDaySlotSchema.nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  })
  .superRefine(checkHalfDayInvariants);

// ---------- Employees ----------
const baseEmployeeFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: emailSchema,
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(1000).optional(),
  position: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  startDate: dateFromYmdSchema.optional(),
  birthday: birthdayYmdSchema.optional(),
  role: userRoleSchema.default("EMPLOYEE"),
  managerId: z.string().min(1).optional(),
  slackUserId: z.string().trim().max(64).optional(),
};

export const employeeCreateSchema = z.object(baseEmployeeFields);

export const employeeUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  position: z.string().trim().max(120).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  startDate: dateFromYmdSchema.nullable().optional(),
  birthday: birthdayYmdSchema.nullable().optional(),
  managerId: z.string().min(1).nullable().optional(),
  slackUserId: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const roleUpdateSchema = z.object({
  role: userRoleSchema,
});

// CSV import row — uses managerEmail not managerId; transforms to DB-friendly types.
export const employeeImportRowSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: emailSchema,
  phone: z.string().trim().max(32).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  address: z.string().trim().max(1000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  position: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  department: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  startDate: z.string().optional().or(z.literal("")).transform((v) => (v && v.length > 0 ? v : undefined)).pipe(
    dateFromYmdSchema.optional(),
  ),
  birthday: z.string().optional().or(z.literal("")).transform((v) => (v && v.length > 0 ? v : undefined)).pipe(
    birthdayYmdSchema.optional(),
  ),
  role: userRoleSchema.optional().default("EMPLOYEE"),
  managerEmail: z.string().optional().or(z.literal("")).transform((v) => (v && v.length > 0 ? v.toLowerCase() : undefined)),
  slackUserId: z.string().trim().max(64).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export const csvImportBodySchema = z.object({
  // base64-encoded CSV content (CSV upload from client as text). We accept
  // raw CSV text here for simplicity; multipart form uploads also supported
  // at the route level.
  csv: z.string().min(1, "CSV content is required"),
  mode: z.enum(["dryrun", "commit"]).default("dryrun"),
  existingEmailPolicy: z.enum(["skip", "update"]).default("skip"),
});

// ---------- Balances ----------
export const balanceAdjustSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: uuidSchema,
  year: z.number().int().min(2000).max(2100),
  allocated: z.number().int().min(0).max(366).optional(),
  used: z.number().int().min(0).max(366).optional(),
  reason: z.string().trim().max(2000).optional(),
});

export const balanceListQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// Drizzle-zod source for reference / typing parity.
export const insertBalanceSchema = insertLeaveBalanceSchema;

// ---------- Holidays ----------
export const holidayCreateSchema = z.object({
  date: dateFromYmdSchema,
  name: z.string().trim().min(1).max(200),
});

export const holidayListQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// Drizzle-zod reference, exported for callers needing a strict select shape.
export const dbInsertHolidaySchema = insertHolidaySchema;

// ---------- Audit logs ----------
export const auditLogFilterSchema = z.object({
  // Exact-match UUID lookup. Kept for forensic deep-links and API consumers
  // that already know the actor's ID. The admin UI no longer surfaces this
  // input — it sends actorQuery instead.
  actorId: z.string().optional(),
  // Free-text substring match against the actor's first name, last name, or
  // email (case-insensitive). Replaces the UUID input on the admin filter UI
  // because nobody recognizes actors by their UUID.
  actorQuery: z.string().trim().min(1).max(100).optional(),
  action: z.string().optional(),
  targetTable: z.string().optional(),
  dateFrom: dateFromYmdSchema.optional(),
  dateTo: dateFromYmdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------- Notifications ----------
export const notificationReadSchema = z
  .object({
    id: uuidSchema.optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.all), {
    message: "Provide either { id } or { all: true } (exactly one)",
  });

export const notificationsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});

// ---------- Generic list filters ----------
export const leaveListQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
  status: requestStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const employeeListQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional(),
});
