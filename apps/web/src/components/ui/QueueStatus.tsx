"use client";

import type { QueueStatusPayload, TrustLevel } from "@rushsite/shared";
import { TRUST_NAMES } from "@/lib/trust";
import { QueueEta } from "@/components/stats/QueueEta";
import { Throbber } from "./Throbber";
import { Timer } from "./Timer";
import styles from "./QueueStatus.module.css";

type QueueStatusProps = {
  status: QueueStatusPayload;
  connection?: "connecting" | "open" | "closed";
  // Freezes timers for static previews
  frozen?: boolean;
  // Opponent trust filter. Shown when above new
  minTrust?: TrustLevel;
};

// Inline status that sits next to the queue button. Throbber and wait timer while queued
export function QueueStatus({ status, connection = "open", frozen, minTrust }: QueueStatusProps) {
  const queued = status.state === "queued" && status.modes.length > 0;
  const since = queued ? Math.min(...status.modes.map((m) => m.queuedAt)) : 0;
  const waitSec = queued ? Math.max(...status.modes.map((m) => m.waitSec)) : 0;

  return (
    <div className={styles.status} aria-live="polite">
      {queued && (
        <span className={styles.item}>
          <Throbber label="Searching" />
          <Timer since={since} frozenSec={frozen ? waitSec : undefined} />
          <QueueEta modes={status.modes} />
          {minTrust && minTrust !== "new" && <span className={styles.filter}>{TRUST_NAMES[minTrust]}+ opponents</span>}
        </span>
      )}
      {status.state === "cooldown" && status.cooldownUntil && (
        <span className={styles.item}>
          <span className={styles.cooldown}>Cooldown</span>
          <Timer until={status.cooldownUntil} frozenSec={frozen ? 60 : undefined} />
        </span>
      )}
      {connection !== "open" && (
        <span className={styles.warn} role="status">
          {connection === "connecting" ? "Connecting" : "Reconnecting"}
        </span>
      )}
    </div>
  );
}
