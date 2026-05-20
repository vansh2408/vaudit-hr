"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import {
  createEmployee,
  listEmployees,
  queryKeys,
  updateEmployee,
} from "@/lib/api/queries";
import {
  birthdayYmdSchema,
  emailSchema,
  userRoleSchema,
} from "@/lib/validation/common";
import type { UserRole } from "@/lib/db/schema";

const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;
const optionalYmd = z
  .string()
  .regex(ymdRegex, "Expected YYYY-MM-DD")
  .optional()
  .or(z.literal("").transform(() => undefined));
const optionalBday = birthdayYmdSchema
  .optional()
  .or(z.literal("").transform(() => undefined));

const formSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: emailSchema,
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  address: z.string().trim().max(1000).optional().or(z.literal("")),
  position: z.string().trim().max(120).optional().or(z.literal("")),
  department: z.string().trim().max(120).optional().or(z.literal("")),
  startDate: optionalYmd,
  birthday: optionalBday,
  role: userRoleSchema,
  managerId: z.string().optional().or(z.literal("")),
  slackUserId: z.string().trim().max(64).optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type EmployeeFormValues = z.infer<typeof formSchema>;

interface Props {
  mode: "create" | "edit";
  /** For edit mode — id of the row being edited */
  id?: string;
  /** Defaults for edit mode */
  initial?: Partial<EmployeeFormValues>;
  onSuccess?: (id: string) => void;
}

const ROLES: ReadonlyArray<UserRole> = [
  "EMPLOYEE",
  "HR_ADMIN",
  "SUPER_ADMIN",
];

function blank(value: string | undefined | null): string {
  return value ?? "";
}

export function EmployeeForm({
  mode,
  id,
  initial,
  onSuccess,
}: Props): React.JSX.Element {
  const router = useRouter();
  const qc = useQueryClient();
  const [, startTransition] = React.useTransition();

  // Manager picker — list active employees (own row excluded).
  const managersQuery = useQuery({
    queryKey: queryKeys.employees.list(false),
    queryFn: () => listEmployees({ includeInactive: false }),
  });
  const managerOptions = (managersQuery.data?.items ?? []).filter(
    (e) => e.id !== id,
  );

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: blank(initial?.firstName),
      lastName: blank(initial?.lastName),
      email: blank(initial?.email),
      phone: blank(initial?.phone),
      address: blank(initial?.address),
      position: blank(initial?.position),
      department: blank(initial?.department),
      startDate: blank(initial?.startDate),
      birthday: blank(initial?.birthday),
      role: initial?.role ?? "EMPLOYEE",
      managerId: blank(initial?.managerId),
      slackUserId: blank(initial?.slackUserId),
      isActive: initial?.isActive ?? true,
    },
  });

  function buildPayload(v: EmployeeFormValues): Record<string, unknown> {
    const out: Record<string, unknown> = {
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email,
      role: v.role,
      isActive: v.isActive,
    };
    if (v.phone) out["phone"] = v.phone;
    if (v.address) out["address"] = v.address;
    if (v.position) out["position"] = v.position;
    if (v.department) out["department"] = v.department;
    if (v.startDate) out["startDate"] = v.startDate;
    if (v.birthday) out["birthday"] = v.birthday;
    if (v.managerId) out["managerId"] = v.managerId;
    if (v.slackUserId) out["slackUserId"] = v.slackUserId;
    return out;
  }

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ["employees"] });
  }

  const createMutation = useMutation({
    mutationFn: (v: EmployeeFormValues) => {
      const payload = buildPayload(v);
      return createEmployee(
        payload as Parameters<typeof createEmployee>[0],
      );
    },
    onSuccess: (res) => {
      toast.success("Employee created");
      invalidate();
      onSuccess?.(res.id);
      startTransition(() => {
        router.push(`/admin/employees/${res.id}`);
      });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : "Could not create");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (v: EmployeeFormValues) => {
      if (!id) throw new Error("Missing id for update");
      // Email is immutable post-create; role goes through the dedicated
      // /role endpoint (rendered as the "Role management" card in the
      // edit view). Strip both before PATCHing the main employee row so
      // the form's success toast can't fire on a no-op.
      const payload = buildPayload(v);
      delete (payload as Record<string, unknown>)["email"];
      delete (payload as Record<string, unknown>)["role"];
      return updateEmployee(id, payload);
    },
    onSuccess: () => {
      toast.success("Saved");
      invalidate();
      router.refresh();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    },
  });

  function onSubmit(values: EmployeeFormValues): void {
    if (mode === "create") createMutation.mutate(values);
    else updateMutation.mutate(values);
  }

  const submitting = createMutation.isPending || updateMutation.isPending;
  const isEdit = mode === "edit";

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="space-y-6"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="firstName" label="First name" error={form.formState.errors.firstName?.message}>
          <Input id="firstName" {...form.register("firstName")} required />
        </Field>
        <Field id="lastName" label="Last name" error={form.formState.errors.lastName?.message}>
          <Input id="lastName" {...form.register("lastName")} required />
        </Field>
        <Field id="email" label="Email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            disabled={isEdit}
            {...form.register("email")}
            required
          />
        </Field>
        <Field id="phone" label="Phone">
          <Input id="phone" {...form.register("phone")} />
        </Field>
        <Field id="position" label="Position">
          <Input id="position" {...form.register("position")} />
        </Field>
        <Field id="department" label="Department">
          <Input id="department" {...form.register("department")} />
        </Field>
        <Field id="startDate" label="Start date" error={form.formState.errors.startDate?.message}>
          <DatePicker
            id="startDate"
            value={form.watch("startDate") || undefined}
            onChange={(v) =>
              form.setValue("startDate", v ?? "", { shouldDirty: true })
            }
          />
        </Field>
        <Field id="birthday" label="Birthday" error={form.formState.errors.birthday?.message}>
          <DatePicker
            id="birthday"
            value={form.watch("birthday") || undefined}
            onChange={(v) =>
              form.setValue("birthday", v ?? "", { shouldDirty: true })
            }
            maxDate={new Date()}
          />
        </Field>
        <Field id="slackUserId" label="Slack user ID">
          <Input id="slackUserId" {...form.register("slackUserId")} />
        </Field>
        <Field id="managerId" label="Manager">
          <Select
            value={form.watch("managerId") ?? ""}
            onValueChange={(v) =>
              form.setValue("managerId", v === "__none__" ? "" : v)
            }
          >
            <SelectTrigger id="managerId" aria-label="Manager">
              <SelectValue placeholder="No manager" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No manager</SelectItem>
              {managerOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.firstName} {m.lastName} · {m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="role" label="Role">
          <Select
            value={form.watch("role")}
            onValueChange={(v) =>
              form.setValue("role", v as UserRole, { shouldDirty: true })
            }
            disabled={isEdit}
          >
            <SelectTrigger id="role" aria-label="Role">
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
          {isEdit ? (
            <p className="text-xs text-muted-foreground">
              Role changes are managed in the Role management section below.
            </p>
          ) : null}
        </Field>
      </div>

      <Field id="address" label="Address">
        <Textarea id="address" rows={2} {...form.register("address")} />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={form.watch("isActive")}
          onCheckedChange={(v) =>
            form.setValue("isActive", v, { shouldDirty: true })
          }
          aria-label="Active"
        />
        Active
      </label>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? "Saving…"
            : mode === "create"
              ? "Create employee"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}

function Field({ id, label, error, children }: FieldProps): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
