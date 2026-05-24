"use client";

import * as React from "react";
import Link from "next/link";
import { AlertOctagon } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Top-level error boundary. Renders a friendly EmptyState instead of leaking
 * the stack trace. `error.digest` is the only safe-to-show server hint.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  React.useEffect(() => {
    // Log to client console — server errors already get logged on the server.
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <EmptyState
        icon={<AlertOctagon />}
        title="Something went wrong"
        description={
          error.digest
            ? `If this keeps happening, share this code with IT: ${error.digest}`
            : "An unexpected error occurred. Please try again."
        }
        action={
          <div className="flex gap-2">
            <Button onClick={() => reset()}>Try again</Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">Go home</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
