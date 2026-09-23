"use client";

import { useEffect, useState } from "react";
import { DECLINE_COOLDOWN } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { Timer } from "@/components/ui/Timer";
import styles from "./CooldownNote.module.css";

const STEPS = DECLINE_COOLDOWN.ladderSec.map((s) => s / 60);
const RESET_HOURS = Math.round(DECLINE_COOLDOWN.decaySec / 3600);

export const COOLDOWN_EXPLAINER_FLAG = "cooldown-explainer";

// Toast body for a decline or accept timeout cooldown. The first one also explains the ladder
export function CooldownNote({ until, explain, onDone }: { until: number; explain: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!explain) return;
    const t = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(t);
  }, [explain]);

  return (
    <div className={styles.note}>
      <p className={styles.line}>
        You can queue again in <Timer until={until} size="sm" />
      </p>
      {explain && (
        <div className={styles.expand} data-open={open}>
          <div className={styles.inner}>
            <p>
              Declining or missing the accept window starts a queue cooldown. It grows each time it happens: {STEPS.slice(0, -1).join(", ")}, then{" "}
              {STEPS.at(-1)} minutes.
            </p>
            <p className="muted">The count resets after {RESET_HOURS} hours without one.</p>
            <Button variant="secondary" onClick={onDone}>
              Got it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
