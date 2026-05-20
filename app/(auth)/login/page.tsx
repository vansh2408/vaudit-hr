import * as React from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in",
};

// Sign-in is a session-dependent page, so it must not be statically
// cached. Force dynamic so the redirect-when-already-authed branch
// below evaluates on every hit.
export const dynamic = "force-dynamic";

/**
 * /login — server shell that wraps the client form in <Suspense> so
 * Next can statically render the surrounding chrome while the form
 * reads `?error=` / `?callbackUrl=` from the URL on the client.
 *
 * If the visitor already has a valid session, send them straight to
 * `/dashboard` — there's nothing to do here. Without this redirect,
 * a logged-in user typing `/login` lands on a sign-in form that's a
 * no-op against their own session, which is confusing.
 */
export default async function LoginPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }
  return <LoginPageContent />;
}

function LoginPageContent(): React.JSX.Element {
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
