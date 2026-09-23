"use client";

import { useId } from "react";
import { cx } from "./cx";
import styles from "./SegmentedControl.module.css";

type Option<V extends string> = { value: V; label: string; disabled?: boolean; title?: string };

type SegmentedControlProps<V extends string> = {
  label: string;
  options: Option<V>[];
  value: V;
  onChange: (v: V) => void;
  disabled?: boolean;
  // Shows the label before the options
  showLabel?: boolean;
};

// Radio group styled as joined buttons. Arrow keys move between options
export function SegmentedControl<V extends string>({ label, options, value, onChange, disabled, showLabel = true }: SegmentedControlProps<V>) {
  const name = useId();
  return (
    <fieldset className={styles.group} disabled={disabled}>
      <legend className={showLabel ? styles.legend : "visually-hidden"}>{label}</legend>
      <div className={styles.options}>
        {options.map((o) => (
          <label key={o.value} className={cx(styles.option, o.value === value && styles.selected, o.disabled && styles.disabled)} title={o.title}>
            <input
              type="radio"
              className="visually-hidden"
              name={name}
              value={o.value}
              checked={o.value === value}
              disabled={o.disabled}
              aria-describedby={o.disabled && o.title ? `${name}-${o.value}-why` : undefined}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
            {o.disabled && o.title && (
              <span id={`${name}-${o.value}-why`} className="visually-hidden">
                {o.title}
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
