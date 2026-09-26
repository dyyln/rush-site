import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import btn from "@/components/ui/Button.module.css";

// A link styled as a button. External links open in a new tab
export function ButtonLink({ href, variant = "primary", children }: { href: string; variant?: "primary" | "secondary" | "ghost"; children: ReactNode }) {
  const className = cx(btn.button, btn[variant], btn.md);
  if (/^https?:/.test(href)) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">
        <span>{children}</span>
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      <span>{children}</span>
    </Link>
  );
}
