"use client";

import { useState } from "react";
import { MODES, queueOpenFlag, type Mode } from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { WarningIcon } from "@/components/stats/WarningIcon";
import { useToast } from "@/components/ui/Toast";
import { MODE_COPY } from "@/lib/modes";
import { adminApi, errorMessage } from "../_lib/client";
import { duration } from "../_lib/format";
import { useLiveData } from "../_lib/live";
import type { OverviewView } from "../_lib/types";
import { ConfirmDialog } from "./parts";
import styles from "../admin.module.css";

// Open or close each queue through its queue.<mode>.open flag
export function QueueToggles({ queue, onChanged }: { queue?: OverviewView["queue"]; onChanged?: () => void }) {
  const toast = useToast();
  const live = useLiveData(() => adminApi.flags(), [], { kinds: ["queue"], pollMs: 30_000 });
  const [closing, setClosing] = useState<Mode | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);

  const isOpen = (mode: Mode) => live.data?.find((f) => f.key === queueOpenFlag(mode))?.enabled ?? true;

  async function set(mode: Mode, open: boolean) {
    setBusy(mode);
    try {
      const r = await adminApi.setFlag(queueOpenFlag(mode), open);
      const drained = r.drained ? ` ${r.drained} waiting ticket${r.drained === 1 ? "" : "s"} removed.` : "";
      toast.push({ title: `${MODE_COPY[mode].label} queue ${open ? "opened" : "closed"}`, body: drained || undefined, tone: open ? "success" : "info" });
      live.reload();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ul className={styles.toggles}>
        {MODES.map((mode) => {
          const open = isOpen(mode);
          const q = queue?.find((x) => x.mode === mode);
          return (
            <li key={mode} className={styles.toggle}>
              <div className={styles.toggleText}>
                <span className={styles.toggleName}>{MODE_COPY[mode].label}</span>
                {live.data ? (
                  open ? (
                    <Badge tone="win">Open</Badge>
                  ) : (
                    <Badge tone="warn">
                      <span className={styles.badgeIcon}>
                        <WarningIcon size={12} />
                        Closed
                      </span>
                    </Badge>
                  )
                ) : (
                  <span className={styles.muted}>--</span>
                )}
                {q && (
                  <span className={`${styles.muted} mono`}>
                    {q.players} waiting{q.tickets > 0 ? `, longest ${duration(q.longestWaitSec)}` : ""}
                  </span>
                )}
              </div>
              <Button
                variant={open ? "secondary" : "primary"}
                disabled={!live.data}
                loading={busy === mode}
                onClick={() => (open ? setClosing(mode) : void set(mode, true).catch((e) => toast.push({ title: "Could not open the queue", body: errorMessage(e), tone: "error" })))}
              >
                {open ? "Close queue" : "Open queue"}
              </Button>
            </li>
          );
        })}
      </ul>
      {live.error && !live.data && <p className={styles.loss}>Could not load queue flags. {errorMessage(live.error)}</p>}
      <ConfirmDialog
        open={closing !== null}
        title={closing ? `Close the ${MODE_COPY[closing].label} queue?` : ""}
        body="New joins are refused and every party waiting in this mode is taken out of it. Parties queued for other modes stay queued there. Matches already found carry on."
        confirmLabel="Close queue"
        danger
        onClose={() => setClosing(null)}
        onConfirm={async () => {
          if (closing) await set(closing, false);
        }}
      />
    </>
  );
}
