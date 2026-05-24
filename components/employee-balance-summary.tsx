import * as React from "react";

import { BalanceCard } from "@/components/balance-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmployeeBalanceRow } from "@/lib/leave/balances-query";

interface Props {
  balances: ReadonlyArray<EmployeeBalanceRow>;
  year: number;
}

/**
 * Read-only leave-balance grid for an employee, rendered on /team/:id
 * and /admin/employees/:id. Mirrors the dashboard's "my balances" grid
 * but lives in a `<Card>` wrapper so it reads as a section on a denser
 * page. Denser grid (`md:grid-cols-3 xl:grid-cols-4`) keeps the cards
 * visually smaller than on the dashboard — they're a glance, not the
 * hero content of the page.
 *
 * Empty state stays inline; no balance rows seeded means HR hasn't set
 * up balances for this employee yet, not an error worth a full
 * `<EmptyState>` treatment.
 */
export function EmployeeBalanceSummary({
  balances,
  year,
}: Props): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leave balance</CardTitle>
      </CardHeader>
      <CardContent>
        {balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No leave balances configured for this employee yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {balances.map((b) => (
              <BalanceCard
                key={b.leaveTypeId}
                typeName={b.leaveTypeName}
                allocated={b.allocated}
                used={b.used}
                description={`Year ${year}`}
                unlimited={!b.isPaid && b.allocated === 0}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}