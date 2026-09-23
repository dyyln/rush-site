import { useId, type ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
import styles from "./Field.module.css";

type Option = { value: string; label: string; disabled?: boolean };

type SelectProps = Omit<ComponentPropsWithoutRef<"select">, "children"> & {
  label: string;
  options: Option[];
  hideLabel?: boolean;
  error?: string;
};

export function Select({ label, options, hideLabel, error, id, className, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={selectId} className={cx(styles.label, hideLabel && "visually-hidden")}>
        {label}
      </label>
      <div className={styles.selectWrap}>
        <select
          id={selectId}
          className={cx(styles.control, styles.select, error && styles.invalid)}
          aria-invalid={error ? true : undefined}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <svg className={styles.chevron} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
