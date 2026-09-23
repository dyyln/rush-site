"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TRUST_NAMES, trustProgressLine, type TrustStatus } from "@/lib/trust";
import { TrustBlocked } from "./TrustBlocked";
import { TrustChecklist } from "./TrustChecklist";
import styles from "./trust.module.css";

// Trust level with its progress line. Click or tap for the checklist
export function TrustChip({ trust }: { trust: TrustStatus }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={styles.chipWrap} ref={wrap}>
      <button
        ref={button}
        type="button"
        className={styles.chip}
        data-level={trust.level}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {trustProgressLine(trust)}
      </button>
      {open && (
        <span id={panelId} className={styles.panel} role="region" aria-label="Trust progress">
          <span className={styles.panelTitle}>{trust.next ? `To reach ${TRUST_NAMES[trust.next]}` : "Top level"}</span>
          <TrustBlocked trust={trust} />
          {trust.requirements.length > 0 && <TrustChecklist requirements={trust.requirements} />}
        </span>
      )}
    </span>
  );
}
