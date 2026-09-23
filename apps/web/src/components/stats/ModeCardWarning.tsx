import { WarningIcon } from "./WarningIcon";
import styles from "./ModeCardWarning.module.css";

// Corner marker for a mode card that the status page reports as unavailable
export function ModeCardWarning() {
  return (
    <span className={styles.badge} aria-hidden="true">
      <WarningIcon />
    </span>
  );
}
