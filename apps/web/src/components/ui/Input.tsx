import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Field.module.css";

type FieldProps = { label: string; hint?: ReactNode; error?: string; hideLabel?: boolean };

export function Input({ label, hint, error, hideLabel, id, className, ...rest }: FieldProps & ComponentPropsWithoutRef<"input">) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errId = `${inputId}-err`;
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={inputId} className={cx(styles.label, hideLabel && "visually-hidden")}>
        {label}
      </label>
      <input
        id={inputId}
        className={cx(styles.control, error && styles.invalid)}
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(hint ? hintId : null, error ? errId : null) || undefined}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
