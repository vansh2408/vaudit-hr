import * as React from "react";
import Link from "next/link";
import { Compass } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="The page you're looking for doesn't exist, or you don't have access."
        action={
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </main>
  );
}
