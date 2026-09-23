"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  // Shows the spinner and blocks clicks. pending is the same as loading
  loading?: boolean;
  pending?: boolean;
  icon?: ReactNode;
};

export type ButtonProps = Omit<ComponentPropsWithoutRef<"button">, "onClick"> &
  Common & {
    // An async handler disables the button and shows the spinner until it settles
    onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
  };

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading,
  pending,
  icon,
  className,
  children,
  disabled,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  const [running, setRunning] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = !!(loading || pending || running);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (!onClick) return;
    if (busyRef.current) {
      e.preventDefault();
      return;
    }
    const result = onClick(e);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      busyRef.current = true;
      setRunning(true);
      const done = () => {
        busyRef.current = false;
        if (mounted.current) setRunning(false);
      };
      (result as Promise<unknown>).then(done, done);
    }
  }

  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], styles[size], block && styles.block, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick ? handleClick : undefined}
      {...rest}
    >
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
}

export type ButtonLinkProps = Common & ComponentPropsWithoutRef<typeof Link>;

export function ButtonLink({ variant = "primary", size = "md", block, icon, className, children, loading: _l, pending: _p, ...rest }: ButtonLinkProps) {
  return (
    <Link className={cx(styles.button, styles[variant], styles[size], block && styles.block, className)} {...rest}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
