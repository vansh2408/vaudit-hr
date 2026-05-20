/**
 * Drizzle schema for Vaudit HR.
 *
 * Notes:
 * - Merged users + NextAuth identity per decisions.md A15 (single source of truth, HR pre-stages rows).
 * - All sensitive enums (role, request status) are pg enums so DB-level integrity matches the type system.
 * - Drizzle-zod insert/select schemas are exported alongside each table for boundary validation.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// ---------- Enums ----------
// "Manager" is NOT a role — it's a structural position derived from the
// `users.managerId` self-reference. Anyone who is somebody's managerId
// can approve that person's requests. See decisions.md.
export const userRoleEnum = pgEnum("user_role", [
  "EMPLOYEE",
  "HR_ADMIN",
  "SUPER_ADMIN",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "PENDING",
  "APPROVED",
  // Owner has asked to cancel an APPROVED request; the manager must approve
  // the cancellation before balance is refunded (for leave) or the row
  // flips to CANCELLED. Introduced to close the "self-undo after approval"
  // hole — see decisions.md / cancel workflow.
  "PENDING_CANCELLATION",
  "REJECTED",
  "CANCELLED",
]);

// ---------- Users (merged NextAuth + Employee) ----------
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // NextAuth-managed fields
  name: text("name"),
  email: varchar("email", { length: 320 }).notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  // HR/employee fields
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  address: text("address"),
  position: varchar("position", { length: 120 }),
  department: varchar("department", { length: 120 }),
  // Calendar dates are TZ-free — stored as PG `date`, read/written as
  // "YYYY-MM-DD" strings. Drizzle's `mode: "string"` keeps JS `Date` out
  // of the picture so the date never shifts under TZ math. See
  // lib/utils/dates.ts for the `Ymd` branded type used at the call sites.
  startDate: date("start_date", { mode: "string" }),
  // birthday stored as YYYY-MM-DD text; cron extracts MM-DD via substring
  // for the daily "is today their birthday" match (A11).
  birthday: varchar("birthday", { length: 10 }),
  role: userRoleEnum("role").notNull().default("EMPLOYEE"),
  // Self-referential FK. ON DELETE SET NULL so deactivating / deleting a
  // manager nulls out direct reports' managerId rather than cascade-deleting
  // people. The AnyPgColumn cast is required because drizzle can't otherwise
  // resolve the type of `users.id` while the `users` table is still being
  // declared.
  managerId: text("manager_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  slackUserId: varchar("slack_user_id", { length: 64 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  manager: one(users, {
    fields: [users.managerId],
    references: [users.id],
    relationName: "manager",
  }),
  directReports: many(users, { relationName: "manager" }),
  leaveBalances: many(leaveBalances),
  leaveRequests: many(leaveRequests, { relationName: "employeeLeave" }),
  wfhRequests: many(wfhRequests, { relationName: "employeeWfh" }),
  notifications: many(notifications),
}));

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);

// ---------- NextAuth tables ----------
export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

// ---------- Holidays ----------
export const holidays = pgTable("holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Calendar date, see comment on users.startDate for rationale.
  date: date("date", { mode: "string" }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const insertHolidaySchema = createInsertSchema(holidays);
export const selectHolidaySchema = createSelectSchema(holidays);

// ---------- Leave Types ----------
export const leaveTypes = pgTable("leave_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  defaultBalance: integer("default_balance").notNull().default(0),
  isPaid: boolean("is_paid").notNull().default(true),
  // Stored as 7-char hex string including '#'
  color: varchar("color", { length: 7 }).notNull().default("#64748b"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertLeaveTypeSchema = createInsertSchema(leaveTypes);
export const selectLeaveTypeSchema = createSelectSchema(leaveTypes);

// ---------- Leave Balances ----------
export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    year: integer("year").notNull(),
    allocated: integer("allocated").notNull().default(0),
    used: integer("used").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqEmployeeTypeYear: unique("uniq_emp_type_year").on(
      t.employeeId,
      t.leaveTypeId,
      t.year,
    ),
  }),
);

export const leaveBalancesRelations = relations(leaveBalances, ({ one }) => ({
  employee: one(users, {
    fields: [leaveBalances.employeeId],
    references: [users.id],
  }),
  leaveType: one(leaveTypes, {
    fields: [leaveBalances.leaveTypeId],
    references: [leaveTypes.id],
  }),
}));

export const insertLeaveBalanceSchema = createInsertSchema(leaveBalances);
export const selectLeaveBalanceSchema = createSelectSchema(leaveBalances);

// ---------- Leave Requests ----------
// totalDays is in HALF-DAY UNITS (2 = full day, 1 = half day) post-0006.
// Display via formatDays(); never assume "days" arithmetic on it.
export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  leaveTypeId: uuid("leave_type_id")
    .notNull()
    .references(() => leaveTypes.id, { onDelete: "restrict" }),
  // Calendar dates — see users.startDate for the why.
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  totalDays: integer("total_days").notNull(),
  reason: text("reason"),
  status: requestStatusEnum("status").notNull().default("PENDING"),
  // Half-day support (0006). isHalfDay implies startDate === endDate and a
  // non-null halfDaySlot; the CHECK constraint chk_leave_half_day in the
  // DB enforces this as defense-in-depth. Validation also runs in Zod at
  // the API boundary so callers see a friendly 400, not a constraint err.
  isHalfDay: boolean("is_half_day").notNull().default(false),
  halfDaySlot: text("half_day_slot"),
  reviewedById: text("reviewed_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { mode: "date" }),
  reviewerNote: text("reviewer_note"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(users, {
    fields: [leaveRequests.employeeId],
    references: [users.id],
    relationName: "employeeLeave",
  }),
  reviewer: one(users, {
    fields: [leaveRequests.reviewedById],
    references: [users.id],
  }),
  leaveType: one(leaveTypes, {
    fields: [leaveRequests.leaveTypeId],
    references: [leaveTypes.id],
  }),
}));

export const insertLeaveRequestSchema = createInsertSchema(leaveRequests);
export const selectLeaveRequestSchema = createSelectSchema(leaveRequests);

// ---------- WFH Requests ----------
// totalDays is in HALF-DAY UNITS (see leaveRequests).
export const wfhRequests = pgTable("wfh_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // WFH is a date range (mirrors leaveRequests). Single-day WFH is a range
  // where startDate === endDate. totalDays is the working-day count excluding
  // weekends/holidays, computed server-side on insert. Stored as TZ-free
  // calendar dates — see users.startDate for the rationale.
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  totalDays: integer("total_days").notNull(),
  reason: text("reason"),
  status: requestStatusEnum("status").notNull().default("PENDING"),
  // Half-day support — see leaveRequests for the contract.
  isHalfDay: boolean("is_half_day").notNull().default(false),
  halfDaySlot: text("half_day_slot"),
  reviewedById: text("reviewed_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { mode: "date" }),
  reviewerNote: text("reviewer_note"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const wfhRequestsRelations = relations(wfhRequests, ({ one }) => ({
  employee: one(users, {
    fields: [wfhRequests.employeeId],
    references: [users.id],
    relationName: "employeeWfh",
  }),
  reviewer: one(users, {
    fields: [wfhRequests.reviewedById],
    references: [users.id],
  }),
}));

export const insertWfhRequestSchema = createInsertSchema(wfhRequests);
export const selectWfhRequestSchema = createSelectSchema(wfhRequests);

// ---------- Notifications ----------
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 64 }).notNull(),
  message: text("message").notNull(),
  link: text("link"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications);
export const selectNotificationSchema = createSelectSchema(notifications);

// ---------- Audit Logs ----------
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  targetTable: varchar("target_table", { length: 100 }).notNull(),
  targetId: text("target_id"),
  // Threat T7 — audit logs must be forensically durable. The metadata
  // payload (before / after / reason) is the entire point of an audit row;
  // a NULL here would silently lose context. `writeAuditLog` already
  // defaults to `{}` so callers can omit the field, and this NOT NULL gives
  // us the matching DB-level guarantee.
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs);
export const selectAuditLogSchema = createSelectSchema(auditLogs);

// ---------- Type exports ----------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Holiday = typeof holidays.$inferSelect;
export type LeaveType = typeof leaveTypes.$inferSelect;
export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type WfhRequest = typeof wfhRequests.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type RequestStatus = (typeof requestStatusEnum.enumValues)[number];
