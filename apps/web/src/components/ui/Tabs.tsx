"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Tabs.module.css";

export type TabItem<K extends string> = { key: K; label: ReactNode; disabled?: boolean };

type TabsProps<K extends string> = {
  label: string;
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  children?: ReactNode;
  // Stable id prefix. Pages use it to point panels at tabs
  idPrefix?: string;
};

// ARIA tabs with arrow key navigation. Render the panel as children
export function Tabs<K extends string>({ label, items, value, onChange, children, idPrefix }: TabsProps<K>) {
  const autoId = useId();
  const prefix = idPrefix ?? autoId;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent) {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.key === value);
    let next: TabItem<K> | undefined;
    if (e.key === "ArrowRight") next = enabled[(idx + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.key);
    refs.current[next.key]?.focus();
  }

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.key === value;
          return (
            <button
              key={item.key}
              ref={(el) => {
                refs.current[item.key] = el;
              }}
              type="button"
              role="tab"
              id={`${prefix}-tab-${item.key}`}
              aria-selected={selected}
              aria-controls={`${prefix}-panel`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cx(styles.tab, selected && styles.selected)}
              onClick={() => onChange(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={`${prefix}-panel`} aria-labelledby={`${prefix}-tab-${value}`} className={styles.panel}>
          {children}
        </div>
      )}
    </div>
  );
}
