"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { Avatar } from "@/components/domain/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface TeamReport {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  department: string | null;
}

interface Props {
  reports: ReadonlyArray<TeamReport>;
}

function matches(r: TeamReport, q: string): boolean {
  if (q.length === 0) return true;
  const hay = `${r.firstName} ${r.lastName} ${r.email} ${r.position ?? ""} ${r.department ?? ""}`.toLowerCase();
  return hay.includes(q);
}

/**
 * Direct-reports grid with client-side typeahead filter. Filtering is in
 * memory — direct-report lists are small enough that paginating or
 * round-tripping the server adds latency without benefit.
 */
export function TeamListClient({ reports }: Props): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const trimmed = query.trim().toLowerCase();
  const filtered = React.useMemo(
    () => reports.filter((r) => matches(r, trimmed)),
    [reports, trimmed],
  );

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, position, or department…"
          aria-label="Filter direct reports"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches for &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => {
            const name = `${r.firstName} ${r.lastName}`;
            return (
              <Link
                key={r.id}
                href={`/team/${r.id}`}
                className="block transition-ui focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={`View ${name}'s leave and WFH history`}
              >
                <Card className="h-full transition-ui hover:shadow-md">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Avatar name={name} size="md" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.position ?? r.email}
                      </p>
                      {r.department ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {r.department}
                        </p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}