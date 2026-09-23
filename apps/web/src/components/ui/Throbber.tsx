import styles from "./Throbber.module.css";

// Small spinning ring in the win colour. Pass a label when it stands alone
export function Throbber({ label }: { label?: string }) {
  return (
    <span className={styles.throbber} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}
