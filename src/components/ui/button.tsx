import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "steel" | "danger";
type Size = "default" | "lg" | "sm";

const variantClasses: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:opacity-90",
  steel: "bg-surface-2 text-ink border border-line hover:bg-line",
  secondary: "bg-surface-2 text-ink hover:bg-line",
  outline: "border border-line-strong text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  danger: "text-error hover:bg-error/10",
};

const sizeClasses: Record<Size, string> = {
  default: "h-11 px-6 text-sm",
  lg: "h-14 px-8 text-base",
  sm: "h-9 px-4 text-xs",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-wide uppercase transition-colors duration-200 disabled:opacity-40 disabled:pointer-events-none",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
