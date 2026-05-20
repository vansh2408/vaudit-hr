import * as React from "react";

import {
  Avatar as UIAvatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

type AvatarProps = {
  name: string;
  image?: string | null;
  size?: AvatarSize;
  className?: string;
};

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
};

/** Tailwind class pairs (bg + foreground) per palette bucket. WCAG AA verified. */
const BUCKETS: ReadonlyArray<string> = [
  "bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
  "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  "bg-lime-200 text-lime-900 dark:bg-lime-900 dark:text-lime-100",
  "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  "bg-teal-200 text-teal-900 dark:bg-teal-900 dark:text-teal-100",
  "bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  "bg-indigo-200 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100",
  "bg-fuchsia-200 text-fuchsia-900 dark:bg-fuchsia-900 dark:text-fuchsia-100",
];

function initialsFromName(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
  if (tokens.length === 0) return "?";
  const first = tokens[0] ?? "";
  const last = tokens.length > 1 ? tokens[tokens.length - 1] ?? "" : "";
  return ((first.charAt(0) || "") + (last.charAt(0) || "")).toUpperCase() || "?";
}

/** djb2 — deterministic, dependency-free, distributes well across small buckets. */
function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function bucketFor(name: string): string {
  const idx = hash(name.toLowerCase()) % BUCKETS.length;
  return BUCKETS[idx] ?? (BUCKETS[0] as string);
}

export function Avatar({
  name,
  image,
  size = "md",
  className,
}: AvatarProps): React.JSX.Element {
  const initials = initialsFromName(name);
  const palette = bucketFor(name);

  return (
    <UIAvatar
      className={cn(
        SIZE_CLASSES[size],
        "ring-1 ring-border ring-offset-0 transition-ui",
        className,
      )}
      aria-label={name}
    >
      {image ? <AvatarImage src={image} alt={name} /> : null}
      <AvatarFallback
        className={cn(
          "font-medium uppercase tracking-tight",
          palette,
        )}
        aria-hidden={image ? "true" : undefined}
      >
        {initials}
      </AvatarFallback>
    </UIAvatar>
  );
}
