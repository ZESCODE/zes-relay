import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "default" | "ghost" | "danger" | "success" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "glass-btn-primary text-white hover:brightness-110",
  success: "glass-btn-success text-white hover:brightness-110",
  danger: "glass-btn-danger text-white hover:brightness-110",
  default: "glass text-[var(--frost-text)] hover:bg-[var(--frost-card-strong)]",
  outline:
    "border border-[var(--frost-border-strong)] text-[var(--frost-text)] hover:bg-[var(--frost-card)]",
  ghost: "text-[var(--frost-muted)] hover:text-[var(--frost-text)] hover:bg-[var(--frost-card)]",
};

const SIZES: Record<ButtonSize, string> = {
  // Mobile-first: 44px minimum tap target, tightened on pointer devices.
  sm: "h-11 min-h-[44px] px-3 text-sm sm:h-8 sm:min-h-0 sm:px-2.5",
  md: "h-11 min-h-[44px] px-4 text-sm sm:h-10 sm:px-3.5",
  lg: "h-12 px-5 text-base",
  icon: "h-11 w-11 sm:h-9 sm:w-9 grid place-items-center",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", loading = false, block, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium",
        "transition-[background-color,border-color,filter,transform] duration-150 tap-scale",
        "disabled:opacity-45 disabled:pointer-events-none select-none",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === "sm" ? 14 : 16} /> : icon}
      {children}
    </button>
  );
});
