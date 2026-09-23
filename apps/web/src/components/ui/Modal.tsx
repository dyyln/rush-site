"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Modal.module.css";

type ModalProps = {
  open: boolean;
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  // Blocking modals cannot be closed with Escape or the backdrop
  blocking?: boolean;
  size?: "sm" | "md";
};

// Uses the native dialog element for focus trapping and the top layer
export function Modal({ open, title, onClose, children, footer, blocking, size = "sm" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, styles[size])}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!blocking) onClose?.();
      }}
      onClick={(e) => {
        if (!blocking && e.target === ref.current) onClose?.();
      }}
    >
      <div className={styles.inner}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {!blocking && onClose && (
            <button type="button" className={styles.close} onClick={onClose}>
              <span className="visually-hidden">Close</span>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}
