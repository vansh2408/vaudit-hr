import * as React from "react";

import { DashboardSkeleton } from "@/components/feedback/skeletons";

export default function Loading(): React.JSX.Element {
  return (
    <div className="pb-10">
      <div className="px-1">
        <DashboardSkeleton />
      </div>
    </div>
  );
}
