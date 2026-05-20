"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, FileWarning, RefreshCcw, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { importEmployees, type ImportResult } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

const CSV_TEMPLATE_HEADERS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "address",
  "position",
  "department",
  "startDate",
  "birthday",
  "role",
  "managerEmail",
  "slackUserId",
];

function buildTemplate(): string {
  return `${CSV_TEMPLATE_HEADERS.join(",")}\nAda,Lovelace,ada@vaudit.com,,,Engineer,Engineering,2025-01-15,12-10,EMPLOYEE,manager@vaudit.com,U123456\n`;
}

function statusClass(status: ImportResult["rowResults"][number]["status"]): string {
  switch (status) {
    case "insert":
      return "text-emerald-700 dark:text-emerald-300";
    case "update":
      return "text-sky-700 dark:text-sky-300";
    case "skip":
      return "text-muted-foreground";
    case "error":
      return "text-destructive";
  }
}

export function ImportClient(): React.JSX.Element {
  const qc = useQueryClient();
  const [csv, setCsv] = React.useState<string>("");
  const [fileName, setFileName] = React.useState<string>("");
  const [policy, setPolicy] = React.useState<"skip" | "update">("skip");
  const [dryrunResult, setDryrunResult] = React.useState<ImportResult | null>(
    null,
  );

  function onFile(file: File | null): void {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const txt =
        typeof reader.result === "string"
          ? reader.result
          : new TextDecoder().decode(reader.result as ArrayBuffer);
      setCsv(txt);
      setDryrunResult(null);
    };
    reader.readAsText(file);
  }

  const dryrun = useMutation({
    mutationFn: () => importEmployees(csv, "dryrun", policy),
    onSuccess: (res) => {
      setDryrunResult(res);
      toast.success("Preview generated");
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof ApiError ? err.message : "Could not preview import",
      );
    },
  });

  const commit = useMutation({
    mutationFn: () => importEmployees(csv, "commit", policy),
    onSuccess: (res) => {
      const c = res.committed;
      toast.success(
        c
          ? `Imported: ${c.inserted} inserted, ${c.updated} updated, ${c.balancesCreated} balances created`
          : "Imported",
      );
      setDryrunResult(res);
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof ApiError ? err.message : "Could not commit import",
      );
    },
  });

  function downloadTemplate(): void {
    const blob = new Blob([buildTemplate()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vaudit-employees-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const hasErrors = (dryrunResult?.errors ?? 0) > 0;
  const canCommit =
    Boolean(dryrunResult) &&
    !hasErrors &&
    (dryrunResult?.willInsert ?? 0) + (dryrunResult?.willUpdate ?? 0) > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Upload CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="csvFile">CSV file</Label>
              <Input
                id="csvFile"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              {fileName ? (
                <p className="text-xs text-muted-foreground">{fileName}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy">Existing email policy</Label>
              <Select
                value={policy}
                onValueChange={(v) => setPolicy(v as "skip" | "update")}
              >
                <SelectTrigger id="policy" aria-label="Existing email policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Skip if email exists</SelectItem>
                  <SelectItem value="update">
                    Update existing record
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={downloadTemplate}
            >
              Download template
            </Button>
            <Button
              onClick={() => dryrun.mutate()}
              disabled={!csv || dryrun.isPending}
            >
              {dryrun.isPending ? (
                <>
                  <RefreshCcw className="h-4 w-4 animate-spin" aria-hidden />
                  Previewing…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" aria-hidden />
                  Preview (dry run)
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {dryrunResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Total rows" value={dryrunResult.totalRows} />
              <Stat label="Insert" value={dryrunResult.willInsert} tone="ok" />
              <Stat label="Update" value={dryrunResult.willUpdate} tone="info" />
              <Stat
                label="Errors"
                value={dryrunResult.errors}
                {...(hasErrors ? { tone: "bad" as const } : {})}
              />
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dryrunResult.rowResults.map((r) => (
                    <tr key={`${r.rowIndex}-${r.email}`}>
                      <td className="px-3 py-2 tabular-nums">{r.rowIndex + 1}</td>
                      <td className="px-3 py-2">{r.email ?? "—"}</td>
                      <td className={cn("px-3 py-2 font-medium", statusClass(r.status))}>
                        {r.status}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.errors.length === 0 ? "—" : r.errors.join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-3">
              {hasErrors ? (
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <FileWarning className="h-4 w-4" aria-hidden />
                  Fix the {dryrunResult.errors} row(s) with errors and re-preview
                  before committing.
                </p>
              ) : dryrunResult.committed ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Import committed.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Looks good — ready to commit.
                </p>
              )}
              <Button
                onClick={() => commit.mutate()}
                disabled={!canCommit || commit.isPending}
              >
                {commit.isPending ? "Committing…" : "Commit import"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "info" | "bad";
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "ok" && "text-emerald-700 dark:text-emerald-300",
          tone === "info" && "text-sky-700 dark:text-sky-300",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}
