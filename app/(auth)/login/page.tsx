import * as React from "react";

import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in",
};

/**
 * /login — server shell that wraps the client form in <Suspense> so
 * Next can statically render the surrounding chrome while the form
 * reads `?error=` / `?callbackUrl=` from the URL on the client.
 */
export default function LoginPage(): React.JSX.Element {
  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with your Vaudit Google account to continue.
        </p>
      </div>
      <React.Suspense
        fallback={
          <div
            role="status"
            aria-live="polite"
            className="h-10 w-full animate-pulse rounded-md bg-muted"
          />
        }
      >
        <LoginForm />
      </React.Suspense>
    </div>
  );
}
