/**
 * Typed query/mutation helpers used by every TanStack Query call site.
 *
 * Query keys live here so revalidation invariants are consistent across pages.
 */
import type { RequestStatus, UserRole } from "@/lib/db/schema";
import { apiFetch, buildQuery } from "./client";

// ---------- Shared shapes ----------

export type ISODateString = string;

export interface LeaveRequestRow {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: ISODateString;
  endDate: ISODateString;
  totalDays: number;
  reason: string | null;
  status: RequestStatus;
  reviewedById: string | null;
  reviewedAt: ISODateString | null;
  reviewerNote: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface WfhRequestRow {
  id: string;
  employeeId: string;
  startDate: ISODateString;
  endDate: ISODateString;
  totalDays: number;
  reason: string | null;
  status: RequestStatus;
  reviewedById: string | null;
  reviewedAt: ISODateString | null;
  reviewerNote: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface EmployeeListRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  department: string | null;
  role: UserRole;
  managerId: string | null;
  slackUserId: string | null;
  startDate: ISODateString | null;
  birthday: string | null;
  isActive: boolean;
}

export interface EmployeeFullRow extends EmployeeListRow {
  phone: string | null;
  address: string | null;
  name: string | null;
  image: string | null;
  emailVerified: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface BalanceRow {
  id: string;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeColor: string;
  year: number;
  allocated: number;
  used: number;
}

export interface HolidayRow {
  id: string;
  date: ISODateString;
  name: string;
  createdAt: ISODateString;
}

export interface NotificationRow {
  id: string;
  employeeId: string;
  type: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: ISODateString;
}

export interface NotificationsListResponse {
  items: NotificationRow[];
  page: number;
  pageSize: number;
  unreadCount: number;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  /** Resolved at fetch time via users join; null if actor was deleted or system-issued. */
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetTable: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: ISODateString;
}

export interface OrgTreeNodeApi {
  id: string;
  name: string;
  position: string | null;
  department: string | null;
  image: string | null;
  children: OrgTreeNodeApi[];
}

export interface ImportRowResult {
  rowIndex: number;
  email: string | null;
  status: "insert" | "update" | "skip" | "error";
  errors: string[];
}

export interface ImportResult {
  mode: "dryrun" | "commit";
  policy: "skip" | "update";
  totalRows: number;
  willInsert: number;
  willUpdate: number;
  willSkip: number;
  errors: number;
  rowResults: ImportRowResult[];
  committed?: {
    inserted: number;
    updated: number;
    balancesCreated: number;
  };
}

// ---------- Query keys ----------

export const queryKeys = {
  leave: {
    mine: (status?: RequestStatus) =>
      ["leave", "mine", status ?? "ALL"] as const,
    one: (id: string) => ["leave", "one", id] as const,
    list: (filters: Record<string, string | undefined>) =>
      ["leave", "list", filters] as const,
  },
  wfh: {
    mine: (status?: RequestStatus) =>
      ["wfh", "mine", status ?? "ALL"] as const,
    one: (id: string) => ["wfh", "one", id] as const,
    list: (filters: Record<string, string | undefined>) =>
      ["wfh", "list", filters] as const,
  },
  approvals: {
    leave: () => ["approvals", "leave"] as const,
    wfh: () => ["approvals", "wfh"] as const,
  },
  employees: {
    list: (includeInactive?: boolean) =>
      ["employees", "list", Boolean(includeInactive)] as const,
    one: (id: string) => ["employees", "one", id] as const,
  },
  balance: {
    mine: (year: number) => ["balance", "mine", year] as const,
    list: (employeeId?: string, year?: number) =>
      ["balances", "list", employeeId ?? "ALL", year ?? "ALL"] as const,
  },
  holidays: {
    list: (year?: number) => ["holidays", "list", year ?? "ALL"] as const,
  },
  audit: {
    list: (filters: Record<string, string | undefined>) =>
      ["audit", "list", filters] as const,
  },
  notifications: {
    recent: () => ["notifications", "recent"] as const,
    all: (page: number, unreadOnly?: boolean) =>
      ["notifications", "all", page, Boolean(unreadOnly)] as const,
  },
  orgChart: () => ["org-chart"] as const,
  team: {
    // Calendar entries are scoped by the date window; admin vs manager
    // scope is resolved server-side, so the cache key doesn't need it.
    calendar: (from: string, to: string) =>
      ["team", "calendar", from, to] as const,
  },
} as const;

// ---------- Leave ----------

export interface ListResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
}

export function listLeave(params: {
  status?: RequestStatus;
  employeeId?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListResponse<LeaveRequestRow>> {
  return apiFetch<ListResponse<LeaveRequestRow>>(
    `/api/leave${buildQuery({
      ...(params.status !== undefined && { status: params.status }),
      ...(params.employeeId !== undefined && { employeeId: params.employeeId }),
      ...(params.page !== undefined && { page: params.page }),
      ...(params.pageSize !== undefined && { pageSize: params.pageSize }),
    })}`,
  );
}

export function getLeave(id: string): Promise<{ item: LeaveRequestRow }> {
  return apiFetch<{ item: LeaveRequestRow }>(`/api/leave/${id}`);
}

export function createLeave(body: {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string;
  isHalfDay?: boolean;
  halfDaySlot?: "FIRST_HALF" | "SECOND_HALF" | null;
}): Promise<{ id: string; totalDays: number; status: RequestStatus }> {
  return apiFetch<{ id: string; totalDays: number; status: RequestStatus }>(
    "/api/leave",
    { method: "POST", body },
  );
}

export function reviewLeave(
  id: string,
  body: {
    action: "APPROVE" | "REJECT" | "APPROVE_CANCEL" | "REJECT_CANCEL" | "WITHDRAW_CANCEL";
    reviewerNote?: string;
  },
): Promise<{ id: string; status: RequestStatus }> {
  return apiFetch<{ id: string; status: RequestStatus }>(`/api/leave/${id}`, {
    method: "PATCH",
    body,
  });
}

/**
 * Owner-initiated cancel. The server picks the right action based on
 * current status: instant for PENDING, cancellation request for APPROVED,
 * error for anything else (use withdrawLeaveCancellation for
 * PENDING_CANCELLATION). The response includes an `action` discriminator so
 * the caller can pick the right toast / message.
 */
export interface CancelLeaveResponse {
  id: string;
  status: RequestStatus;
  refunded: boolean;
  action:
    | "cancelled"
    | "cancellation_requested"
    | "cancellation_approved"
    | "cancellation_rejected"
    | "cancellation_withdrawn";
}

export function cancelLeave(id: string): Promise<CancelLeaveResponse> {
  return apiFetch<CancelLeaveResponse>(`/api/leave/${id}`, { method: "DELETE" });
}

/** Admin force-cancel with mandatory reason. */
export function adminCancelLeave(
  id: string,
  reason: string,
): Promise<CancelLeaveResponse> {
  return apiFetch<CancelLeaveResponse>(
    `/api/leave/${id}?override=1`,
    { method: "DELETE", body: { reason } },
  );
}

/** Owner withdraws their pending cancellation request. */
export function withdrawLeaveCancellation(
  id: string,
): Promise<{ id: string; status: RequestStatus }> {
  return apiFetch<{ id: string; status: RequestStatus }>(`/api/leave/${id}`, {
    method: "PATCH",
    body: { action: "WITHDRAW_CANCEL" },
  });
}

export function editLeave(
  id: string,
  body: {
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    reason?: string;
    isHalfDay?: boolean;
    halfDaySlot?: "FIRST_HALF" | "SECOND_HALF" | null;
  },
): Promise<{ id: string; totalDays: number; status: RequestStatus }> {
  return apiFetch<{ id: string; totalDays: number; status: RequestStatus }>(
    `/api/leave/${id}`,
    { method: "PATCH", body: { action: "EDIT", ...body } },
  );
}

// ---------- WFH ----------

export function listWfh(params: {
  status?: RequestStatus;
  employeeId?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListResponse<WfhRequestRow>> {
  return apiFetch<ListResponse<WfhRequestRow>>(
    `/api/wfh${buildQuery({
      ...(params.status !== undefined && { status: params.status }),
      ...(params.employeeId !== undefined && { employeeId: params.employeeId }),
      ...(params.page !== undefined && { page: params.page }),
      ...(params.pageSize !== undefined && { pageSize: params.pageSize }),
    })}`,
  );
}

export function getWfh(id: string): Promise<{ item: WfhRequestRow }> {
  return apiFetch<{ item: WfhRequestRow }>(`/api/wfh/${id}`);
}

export function createWfh(body: {
  startDate: string;
  endDate: string;
  reason?: string;
  isHalfDay?: boolean;
  halfDaySlot?: "FIRST_HALF" | "SECOND_HALF" | null;
}): Promise<{ id: string; status: RequestStatus; totalDays: number }> {
  return apiFetch<{ id: string; status: RequestStatus; totalDays: number }>(
    "/api/wfh",
    { method: "POST", body },
  );
}

export function reviewWfh(
  id: string,
  body: {
    action: "APPROVE" | "REJECT" | "APPROVE_CANCEL" | "REJECT_CANCEL" | "WITHDRAW_CANCEL";
    reviewerNote?: string;
  },
): Promise<{ id: string; status: RequestStatus }> {
  return apiFetch<{ id: string; status: RequestStatus }>(`/api/wfh/${id}`, {
    method: "PATCH",
    body,
  });
}

/** Same shape as cancelLeave; `refunded` is always false for WFH. */
export interface CancelWfhResponse {
  id: string;
  status: RequestStatus;
  action:
    | "cancelled"
    | "cancellation_requested"
    | "cancellation_approved"
    | "cancellation_rejected"
    | "cancellation_withdrawn";
}

export function cancelWfh(id: string): Promise<CancelWfhResponse> {
  return apiFetch<CancelWfhResponse>(`/api/wfh/${id}`, { method: "DELETE" });
}

export function adminCancelWfh(
  id: string,
  reason: string,
): Promise<CancelWfhResponse> {
  return apiFetch<CancelWfhResponse>(`/api/wfh/${id}?override=1`, {
    method: "DELETE",
    body: { reason },
  });
}

export function withdrawWfhCancellation(
  id: string,
): Promise<{ id: string; status: RequestStatus }> {
  return apiFetch<{ id: string; status: RequestStatus }>(`/api/wfh/${id}`, {
    method: "PATCH",
    body: { action: "WITHDRAW_CANCEL" },
  });
}

export function editWfh(
  id: string,
  body: {
    startDate: string;
    endDate: string;
    reason?: string;
    isHalfDay?: boolean;
    halfDaySlot?: "FIRST_HALF" | "SECOND_HALF" | null;
  },
): Promise<{ id: string; totalDays: number; status: RequestStatus }> {
  return apiFetch<{ id: string; totalDays: number; status: RequestStatus }>(
    `/api/wfh/${id}`,
    { method: "PATCH", body: { action: "EDIT", ...body } },
  );
}

// ---------- Admin: Employees ----------

export function listEmployees(params: {
  includeInactive?: boolean;
}): Promise<{ items: EmployeeListRow[] }> {
  return apiFetch<{ items: EmployeeListRow[] }>(
    `/api/admin/employees${buildQuery({
      ...(params.includeInactive !== undefined && {
        includeInactive: params.includeInactive,
      }),
    })}`,
  );
}

export function getEmployee(id: string): Promise<{ item: EmployeeFullRow }> {
  return apiFetch<{ item: EmployeeFullRow }>(`/api/admin/employees/${id}`);
}

export function createEmployee(body: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  position?: string;
  department?: string;
  startDate?: string;
  birthday?: string;
  role: UserRole;
  managerId?: string;
  slackUserId?: string;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/api/admin/employees", {
    method: "POST",
    body,
  });
}

export function updateEmployee(
  id: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/admin/employees/${id}`, {
    method: "PATCH",
    body,
  });
}

export function deactivateEmployeeReq(
  id: string,
): Promise<{ id: string; deactivated: boolean }> {
  return apiFetch<{ id: string; deactivated: boolean }>(
    `/api/admin/employees/${id}`,
    { method: "DELETE" },
  );
}

export function updateEmployeeRole(
  id: string,
  role: UserRole,
): Promise<{ id: string; role: UserRole; changed: boolean }> {
  return apiFetch<{ id: string; role: UserRole; changed: boolean }>(
    `/api/admin/employees/${id}/role`,
    { method: "PATCH", body: { role } },
  );
}

export function importEmployees(
  csv: string,
  mode: "dryrun" | "commit",
  policy: "skip" | "update",
): Promise<ImportResult> {
  return apiFetch<ImportResult>(`/api/admin/employees/import?mode=${mode}`, {
    method: "POST",
    body: { csv, mode, existingEmailPolicy: policy },
  });
}

// ---------- Admin: Balances ----------

export function listBalances(params: {
  employeeId?: string;
  year?: number;
}): Promise<{ items: BalanceRow[] }> {
  return apiFetch<{ items: BalanceRow[] }>(
    `/api/admin/balances${buildQuery({
      ...(params.employeeId !== undefined && { employeeId: params.employeeId }),
      ...(params.year !== undefined && { year: params.year }),
    })}`,
  );
}

export function adjustBalance(body: {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocated?: number;
  used?: number;
  reason?: string;
}): Promise<{ id?: string; created?: boolean; updated?: boolean }> {
  return apiFetch<{ id?: string; created?: boolean; updated?: boolean }>(
    "/api/admin/balances",
    { method: "PATCH", body },
  );
}

// ---------- Team calendar ----------

export interface TeamCalendarItem {
  kind: "leave" | "wfh";
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string | null;
  leaveTypeName: string | null;
  /** Hex like "#3b82f6". Null for WFH (we render a neutral chip). */
  leaveTypeColor: string | null;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDaySlot: "FIRST_HALF" | "SECOND_HALF" | null;
  status: RequestStatus;
}

export function listTeamCalendar(params: {
  from: string;
  to: string;
}): Promise<{ items: TeamCalendarItem[] }> {
  return apiFetch<{ items: TeamCalendarItem[] }>(
    `/api/team/calendar${buildQuery({ from: params.from, to: params.to })}`,
  );
}

// ---------- Holidays ----------
// GET is open to any signed-in user (holidays are public reference data);
// POST/DELETE are still admin-gated server-side.

export function listHolidays(params: {
  year?: number;
}): Promise<{ items: HolidayRow[] }> {
  return apiFetch<{ items: HolidayRow[] }>(
    `/api/holidays${buildQuery({
      ...(params.year !== undefined && { year: params.year }),
    })}`,
  );
}

export function createHoliday(body: {
  date: string;
  name: string;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/api/holidays", {
    method: "POST",
    body,
  });
}

export function deleteHoliday(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/api/holidays/${id}`,
    { method: "DELETE" },
  );
}

// ---------- Admin: Audit logs ----------

export function listAuditLogs(params: {
  actorId?: string;
  /** Substring match on first name / last name / email. */
  actorQuery?: string;
  action?: string;
  targetTable?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListResponse<AuditLogRow>> {
  return apiFetch<ListResponse<AuditLogRow>>(
    `/api/admin/audit-logs${buildQuery({
      ...(params.actorId !== undefined && { actorId: params.actorId }),
      ...(params.actorQuery !== undefined && { actorQuery: params.actorQuery }),
      ...(params.action !== undefined && { action: params.action }),
      ...(params.targetTable !== undefined && { targetTable: params.targetTable }),
      ...(params.dateFrom !== undefined && { dateFrom: params.dateFrom }),
      ...(params.dateTo !== undefined && { dateTo: params.dateTo }),
      ...(params.page !== undefined && { page: params.page }),
      ...(params.pageSize !== undefined && { pageSize: params.pageSize }),
    })}`,
  );
}

// ---------- Notifications ----------

export function listNotifications(params: {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}): Promise<NotificationsListResponse> {
  return apiFetch<NotificationsListResponse>(
    `/api/notifications${buildQuery({
      ...(params.page !== undefined && { page: params.page }),
      ...(params.pageSize !== undefined && { pageSize: params.pageSize }),
      ...(params.unreadOnly !== undefined && { unreadOnly: params.unreadOnly }),
    })}`,
  );
}

export function markNotificationRead(
  body: { id: string } | { all: true },
): Promise<{ id?: string; updated?: true | "all" }> {
  return apiFetch<{ id?: string; updated?: true | "all" }>(
    "/api/notifications/read",
    { method: "POST", body },
  );
}

// ---------- Org chart ----------

export function getOrgChart(): Promise<{ roots: OrgTreeNodeApi[] }> {
  return apiFetch<{ roots: OrgTreeNodeApi[] }>("/api/org-chart");
}
