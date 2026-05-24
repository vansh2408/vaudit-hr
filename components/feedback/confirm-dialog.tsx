"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  /** Element that opens the dialog (e.g. a destructive Button). */
  trigger: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm action as destructive (default true). */
  destructive?: boolean;
  /** Async-aware confirm handler. The dialog won't auto-close on rejection. */
  onConfirm: () => void | Promise<void>;
  /** Controlled open state, optional. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
  open,
  onOpenChange,
  className,
}: ConfirmDialogProps): React.JSX.Element {
  const [pending, setPending] = React.useState(false);
  const [internalOpen, setInternalOpen] = React.useState(false);

  const isControlled = typeof open === "boolean";
  const currentOpen = isControlled ? open : internalOpen;

  function setOpen(next: boolean): void {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  async function handleConfirm(event: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // Swallow — the caller's onError (e.g. react-query mutation handler)
      // is responsible for surfacing the failure via toast. We keep the
      // dialog open on rejection per the documented contract, and we don't
      // want the rejection to escape as an unhandled promise (Next.js dev
      // would surface it as an "Unhandled Runtime Error" even though the
      // user already saw the toast).
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={currentOpen} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className={className}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className={cn(
              destructive &&
                buttonVariants({ variant: "destructive" }),
            )}
          >
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
