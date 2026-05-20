import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/skeletons";

export default function Loading(): React.JSX.Element {
  return (
    <div className="pb-10">
      <header className="flex flex-col gap-2 py-3">
        <Skeleton className="h-8 w-48 sm:h-9" />
        <Skeleton className="h-4 w-72" />
      </header>
      <div className="mt-6 px-1">
        <TableSkeleton rows={6} cols={5} />
      </div>
    </div>
  );
}
