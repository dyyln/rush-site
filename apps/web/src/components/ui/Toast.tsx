"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Toast.module.css";

export type ToastTone = "info" | "success" | "error";
export type ToastInput = { title: string; body?: ReactNode; tone?: ToastTone; durationMs?: number };
type ToastItem = ToastInput & { id: number; tone: ToastTone };

type ToastApi = { push: (t: ToastInput) => number; dismiss: (id: number) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { ...t, id, tone: t.tone ?? "info" }]);
      const ms = t.durationMs ?? 5000;
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastRegion items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

function ToastRegion({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className={styles.region} role="region" aria-label="Notifications">
      <ol className={styles.list} aria-live="polite">
        {items.map((t) => (
          <li key={t.id}>
            <Toast title={t.title} body={t.body} tone={t.tone} onDismiss={() => onDismiss(t.id)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Toast({
  title,
  body,
  tone = "info",
  onDismiss,
}: {
  title: string;
  body?: ReactNode;
  tone?: ToastTone;
  onDismiss?: () => void;
}) {
  return (
    <div className={cx(styles.toast, styles[tone])} role={tone === "error" ? "alert" : "status"}>
      <div className={styles.text}>
        <p className={styles.title}>{title}</p>
        {body && <div className={styles.body}>{body}</div>}
      </div>
      {onDismiss && (
        <button type="button" className={styles.close} onClick={onDismiss}>
          <span className="visually-hidden">Dismiss</span>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
