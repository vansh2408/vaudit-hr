import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Form-style text input. Password-manager overlays (LastPass, 1Password,
 * Bitwarden, Dashlane) are suppressed by default because this app's only
 * credential surface is Google OAuth — every other input is HR data about
 * other people, and a chiclet appearing on focus shifts the caret and
 * causes visible layout jitter between fields. Callers can re-enable
 * autofill on a specific input by passing the relevant data-* prop.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        autoComplete={props.autoComplete ?? "off"}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
