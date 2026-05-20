"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Validates a callback URL is a same-origin relative path so a poisoned
 * `?callbackUrl=https://evil.example` query param can't redirect through us.
 */
function safeCallbackUrl(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Reject protocol-relative or absolute URLs to other origins.
  if (raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return "/dashboard";
  }
  if (!raw.startsWith("/")) return "/dashboard";
  return raw;
}

function GoogleGlyph(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
    >
      <path d="M21.35 11.1H12v3.18h5.36c-.23 1.43-1.66 4.2-5.36 4.2A6.48 6.48 0 0 1 5.5 12 6.48 6.48 0 0 1 12 5.5c1.84 0 3.07.79 3.77 1.46l2.57-2.47C16.78 3.04 14.6 2.1 12 2.1A9.9 9.9 0 0 0 2.1 12 9.9 9.9 0 0 0 12 21.9c5.72 0 9.5-4.02 9.5-9.7 0-.65-.07-1.14-.15-1.1z" />
    </svg>
  );
}

const ERROR_COPY: Record<string, string> = {
  AccessDenied:
    "Your account hasn't been set up yet. Please contact HR to get access.",
  Verification: "The sign-in link is no longer valid. Please try again.",
  OAuthAccountNotLinked:
    "This Google account isn't linked to your Vaudit profile. Contact HR.",
  Configuration:
    "Authentication is misconfigured. Contact your administrator.",
};

export function LoginForm(): React.JSX.Element {
  const params = useSearchParams();
  const rawError = params?.get("error");
  const rawCallback = params?.get("callbackUrl") ?? null;
  const callbackUrl = safeCallbackUrl(rawCallback);
  const [pending, setPending] = React.useState(false);

  const errorMessage = rawError
    ? (ERROR_COPY[rawError] ?? ERROR_COPY["AccessDenied"] ?? "Unable to sign in.")
    : null;

  function handleSignIn(): void {
    if (pending) return;
    setPending(true);
    // signIn triggers a full-page redirect; no need to clear pending state.
    void signIn("google", { callbackUrl });
  }

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <div
          role="alert"
          className={cn(
            "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive",
          )}
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{errorMessage}</p>
        </div>
      ) : null}

      <Button
        type="button"
        onClick={handleSignIn}
        disabled={pending}
        className="h-11 w-full gap-2"
        aria-label="Sign in with Google"
      >
        <GoogleGlyph />
        <span>{pending ? "Redirecting…" : "Sign in with Google"}</span>
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Only pre-staged Vaudit / BlokID accounts can sign in. Need access?
        Email HR.
      </p>
    </div>
  );
}
