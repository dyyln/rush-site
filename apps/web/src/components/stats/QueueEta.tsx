import type { QueueModeStatus } from "@rushsite/shared";
import { etaRange } from "@/components/play/eta";
import styles from "./QueueEta.module.css";

// Estimated wait for the queued modes. The first match found wins, so the shortest estimate applies
export function QueueEta({ modes }: { modes: QueueModeStatus[] }) {
  const estimates = modes.map((m) => m.estimatedSec).filter((s): s is number => typeof s === "number");
  if (estimates.length === 0) return null;
  const eta = Math.min(...estimates);
  return (
    <span className={styles.eta}>
      <span className={styles.label}>Est.</span>
      <span className="mono">{etaRange(eta)}</span>
    </span>
  );
}
