import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";

interface Props {
  title?: string;
  description?: string;
  /** Where the "Back" button points. Defaults to /dashboard. */
  backHref?: string;
  backLabel?: string;
}

/**
 * Friendly "you don't have access to this page" page. Used by admin
 * routes when a non-admin lands on them (typed URL, stale link, etc.).
 *
 * Why this exists: pages that throw `ForbiddenError` end up at the
 * top-level `app/error.tsx` boundary which shows the scary
 * "Something went wrong" page meant for real bugs. Authorization
 * failures should look different — they're cosmetic UX, not a sign
 * of trouble.
 */
export function NoAccess({
  title = "You don't have access to this page",
  description = "This area is restricted to HR admins. If you think you should have access, ask an HR admin to update your role.",
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
}: Props): React.JSX.Element {
  return (
    <PageShell title={title} description="">
      <EmptyState
        icon={<Lock />}
        title={title}
        description={description}
        action={
          <Button asChild>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        }
      />
    </PageShell>
  );
}
