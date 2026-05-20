"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/client";
import {
  deactivateEmployeeReq,
  updateEmployeeRole,
} from "@/lib/api/queries";
import type { UserRole } from "@/lib/db/schema";
import { EmployeeForm, type EmployeeFormValues } from "../employee-form";

interface Props {
  id: string;
  canChangeRole: boolean;
  isSelf: boolean;
  isActive: boolean;
  initial: EmployeeFormValues;
}

const ROLES: ReadonlyArray<UserRole> = [
  "EMPLOYEE",
  "HR_ADMIN",
  "SUPER_ADMIN",
];

const ADMIN_ROLES: ReadonlySet<UserRole> = new Set(["HR_ADMIN", "SUPER_ADMIN"]);

export function EmployeeEditView({
  id,
  canChangeRole,
  isSelf,
  isActive,
  initial,
}: Props): React.JSX.Element {
  const qc = useQueryClient();
  const router = useRouter();
  const [pendingRole, setPendingRole] = React.useState<UserRole>(initial.role);
  const roleChanged = pendingRole !== initial.role;
  // Self-role-change is permitted (the API's last-active-SUPER_ADMIN guard
  // prevents lockout), but it's destructive — once you demote yourself only
  // another SUPER_ADMIN can restore you. Confirm before submission.
  const needsSelfConfirm = isSelf && roleChanged;

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ["employees"] });
    router.refresh();
  }

  const deactivate = useMutation({
    mutationFn: () => deactivateEmployeeReq(id),
    onSuccess: () => {
      toast.success("Employee deactivated");
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : "Could not deactivate");
    },
  });

  const roleChange = useMutation({
    mutationFn: (role: UserRole) => updateEmployeeRole(id, role),
    onSuccess: (res) => {
      toast.success(
        res.changed ? `Role changed to ${res.role}` : "Role unchanged",
      );
      void qc.invalidateQueries({ queryKey: ["employees"] });
      // If the user just demoted themselves below admin tier, they no
      // longer have access to this admin route — refreshing here would
      // throw ForbiddenError from requireAdmin() and land them on the
      // generic error boundary. Redirect to /dashboard instead.
      if (isSelf && res.changed && !ADMIN_ROLES.has(res.role)) {
        router.replace("/dashboard");
        return;
      }
      router.refresh();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : "Could not change role");
    },
  });

  return (
    <div className="space-y-8">
      {/* Remount the form when the server-side role changes so the
          disabled role select picks up the new value. react-hook-form
          only consumes `defaultValues` on mount, and router.refresh()
          does not reset client state. */}
      <EmployeeForm key={initial.role} mode="edit" id={id} initial={initial} />

      {canChangeRole ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Role management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Changing a role is audit-logged. SUPER_ADMIN only.
              {isSelf
                ? " Demoting yourself revokes super-admin access — only another SUPER_ADMIN can restore it."
                : null}
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={pendingRole}
                onValueChange={(v) => setPendingRole(v as UserRole)}
              >
                <SelectTrigger className="w-48" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {needsSelfConfirm ? (
                <ConfirmDialog
                  title="Change your own role?"
                  description={`You will be changed from ${initial.role} to ${pendingRole}. You will lose super-admin access immediately, and only another SUPER_ADMIN can restore it.`}
                  confirmLabel="Yes, change my role"
                  onConfirm={async () => {
                    await roleChange.mutateAsync(pendingRole);
                  }}
                  trigger={
                    <Button disabled={roleChange.isPending}>
                      {roleChange.isPending ? "Saving…" : "Change role"}
                    </Button>
                  }
                />
              ) : (
                <Button
                  onClick={() => roleChange.mutate(pendingRole)}
                  disabled={roleChange.isPending || !roleChanged}
                >
                  {roleChange.isPending ? "Saving…" : "Change role"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isActive && !isSelf ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Deactivating cancels any pending leave or WFH requests and revokes
              sign-in. They will keep historical records.
            </p>
            <ConfirmDialog
              title="Deactivate this employee?"
              description="They will be signed out of all sessions and any pending requests will be cancelled."
              confirmLabel="Deactivate"
              onConfirm={async () => {
                await deactivate.mutateAsync();
              }}
              trigger={
                <Button variant="destructive" disabled={deactivate.isPending}>
                  {deactivate.isPending ? "Working…" : "Deactivate employee"}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
