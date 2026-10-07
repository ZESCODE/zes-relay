import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/format";

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
}

export function Field({ label, hint, error, htmlFor, className, children, action }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={htmlFor}
            className="text-xs font-medium text-[var(--frost-muted)] uppercase tracking-wide"
          >
            {label}
          </label>
          {action}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[var(--frost-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Input({ className, invalid, mono, ...rest }: InputProps) {
  return (
    <input
      className={cn(
        "glass-input w-full px-3 py-2.5 sm:py-2 text-sm",
        mono && "font-mono text-[13px]",
        invalid && "border-red-500/70 focus:border-red-400",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Textarea({ className, invalid, mono, ...rest }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "glass-input w-full px-3 py-2.5 text-sm resize-y",
        mono && "font-mono text-[13px]",
        invalid && "border-red-500/70",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
