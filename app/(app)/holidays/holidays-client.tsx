"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Palmtree, Plus, Trash2 } from "lucide-react";
import { z } from "zod";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { DatePicker } from "@/components/forms/date-picker";
import { EmptyState } from "@/components/feedback/empty-state";
import { TableSkeleton } from "@/components/feedback/skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/client";
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  queryKeys,
  type HolidayRow,
} from "@/lib/api/queries";
import { emptyStates } from "@/lib/copy/empty-states";
import { formatYmdHuman, unsafeYmd } from "@/lib/utils/dates";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

const formSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  name: z.string().trim().min(1, "Name is required").max(200),
});

type FormValues = z.infer<typeof formSchema>;

function fmt(iso: string): string {
  // `iso` is a YYYY-MM-DD calendar date from the API, not an instant.
  // `new Date("YYYY-MM-DD")` would parse as UTC midnight and shift the
  // day in any non-UTC TZ; route everything through the Ymd helpers.
  return formatYmdHuman(unsafeYmd(iso), {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface Props {
  /** Whether the current viewer can mutate (add / remove) holidays.
   * UI hint only — the server still enforces admin on POST/DELETE. */
  isAdmin: boolean;
}

export function HolidaysClient({ isAdmin }: Props): React.JSX.Element {
  const qc = useQueryClient();
  const [year, setYear] = React.useState<number>(CURRENT_YEAR);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { date: "", name: "" },
  });

  const holidaysQuery = useQuery({
    queryKey: queryKeys.holidays.list(year),
    queryFn: () => listHolidays({ year }),
  });

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ["holidays"] });
  }

  const create = useMutation({
    mutationFn: (v: FormValues) => createHoliday({ date: v.date, name: v.name }),
    onSuccess: () => {
      toast.success("Holiday added");
      form.reset({ date: "", name: "" });
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : "Could not add");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteHoliday(id),
    onSuccess: () => {
      toast.success("Holiday removed");
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : "Could not delete");
    },
  });

  const items: HolidayRow[] = holidaysQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <form
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          className="grid items-end gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_2fr_auto]"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="hol-date">Date</Label>
            <DatePicker
              id="hol-date"
              value={form.watch("date") || undefined}
              onChange={(v) =>
                form.setValue("date", v ?? "", {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
            {form.formState.errors.date ? (
              <p className="text-xs font-medium text-destructive">
                {form.formState.errors.date.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hol-name">Name</Label>
            <Input
              id="hol-name"
              placeholder="e.g. New Year's Day"
              {...form.register("name")}
              aria-invalid={Boolean(form.formState.errors.name)}
            />
            {form.formState.errors.name ? (
              <p className="text-xs font-medium text-destructive">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={create.isPending}>
            <Plus className="h-4 w-4" aria-hidden />
            {create.isPending ? "Adding…" : "Add holiday"}
          </Button>
        </form>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor="year-filter" className="text-xs uppercase tracking-wide text-muted-foreground">
            Year
          </Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger id="year-filter" className="h-9 w-32" aria-label="Filter by year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {holidaysQuery.isLoading ? (
        <TableSkeleton rows={8} cols={isAdmin ? 3 : 2} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Palmtree />}
          title={emptyStates.noHolidays.title}
          description={
            isAdmin
              ? emptyStates.noHolidays.description
              : `No holidays configured for ${year}. HR will add company holidays here once they're scheduled.`
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Name</th>
                {isAdmin ? (
                  <th className="px-3 py-2 text-right">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((h) => (
                <tr key={h.id}>
                  <td className="px-3 py-2">{fmt(h.date)}</td>
                  <td className="px-3 py-2">{h.name}</td>
                  {isAdmin ? (
                    <td className="px-3 py-2 text-right">
                      <ConfirmDialog
                        title="Remove this holiday?"
                        description="Removing won't change past leave totals, but future requests will not exclude this date."
                        confirmLabel="Remove"
                        onConfirm={async () => {
                          await remove.mutateAsync(h.id);
                        }}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${h.name}`}
                            className="text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        }
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
