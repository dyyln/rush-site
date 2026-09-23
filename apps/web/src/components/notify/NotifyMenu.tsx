"use client";

import { useEffect, useId, useRef, useState } from "react";
import { NotifyPanel } from "./NotifyPanel";
import styles from "./notify.module.css";

// Header button that opens the notification settings
export function NotifyMenu() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.menu} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 3a4.5 4.5 0 0 0-4.5 4.5v2.8L4 13h12l-1.5-2.7V7.5A4.5 4.5 0 0 0 10 3Zm-2 12a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        <span className={styles.triggerText}>Alerts</span>
      </button>
      {open && (
        <div id={id} role="dialog" aria-label="Notification settings" className={styles.popover}>
          <p className={styles.heading}>Notifications</p>
          <NotifyPanel />
        </div>
      )}
    </div>
  );
}
