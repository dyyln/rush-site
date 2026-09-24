import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Card.module.css";

type CardProps = ComponentPropsWithoutRef<"section"> & {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "raised" | "accent" | "flat";
  padded?: boolean;
  as?: "section" | "div" | "article";
};

export function Card({ title, eyebrow, actions, tone = "default", padded = true, as = "section", className, children, ...rest }: CardProps) {
  const Tag = as;
  return (
    <Tag className={cx("glass", styles.card, styles[tone], padded && styles.padded, className)} {...rest}>
      {(title || actions || eyebrow) && (
        <header className={styles.header}>
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className={styles.title}>{title}</h2>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}
