import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
};

export type ButtonProps = Common & ComponentPropsWithoutRef<"button">;

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], styles[size], block && styles.block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
}

export type ButtonLinkProps = Common & ComponentPropsWithoutRef<typeof Link>;

export function ButtonLink({ variant = "primary", size = "md", block, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={cx(styles.button, styles[variant], styles[size], block && styles.block, className)} {...rest}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
