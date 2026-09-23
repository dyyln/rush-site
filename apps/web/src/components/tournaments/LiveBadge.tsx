import { Badge } from "@/components/ui/Badge";
import styles from "./LiveBadge.module.css";

export function LiveBadge({ label = "Live" }: { label?: string }) {
  return (
    <Badge tone="win">
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </Badge>
  );
}
