import * as React from "react";
import { and, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { WfhListClient } from "./wfh-list-client";

/**
 * Server wrapper that loads the company holidays for the current year and
 * hands them to the client list. The WFH dialog uses them to exclude
 * weekends + holidays from the working-days count, matching leave.
 */
export async function WfhListView(): Promise<React.JSX.Element> {
  const year = new Date().getFullYear();
  const holidayRows = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(
      and(
        gte(holidays.date, `${year}-01-01`),
        lte(holidays.date, `${year}-12-31`),
      ),
    );
  // holidays.date is already YYYY-MM-DD (Drizzle mode: "string"), pass straight
  // through. Prop name kept as `holidayDatesYmd` after rename below.
  const holidayYmd = holidayRows.map((h) => h.date);
  return <WfhListClient holidayDatesYmd={holidayYmd} />;
}
