"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { steamLoginUrl } from "@/lib/api";
import { cx } from "./cx";
import styles from "./Button.module.css";

type SignInLinkProps = {
  children?: ReactNode;
  // Defaults to the current page
  returnTo?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  // Skips button styling so callers can style it
  className?: string;
  plain?: boolean;
  onClick?: () => void;
};

// Plain anchor to Steam sign in. The api redirects back to returnTo
export function SignInLink({ children = "Sign in with Steam", returnTo, variant = "primary", size = "md", className, plain, onClick }: SignInLinkProps) {
  const pathname = usePathname();
  const href = steamLoginUrl(returnTo ?? pathname);
  return (
    <a href={href} className={plain ? className : cx(styles.button, styles[variant], styles[size], className)} onClick={onClick}>
      <span>{children}</span>
    </a>
  );
}
