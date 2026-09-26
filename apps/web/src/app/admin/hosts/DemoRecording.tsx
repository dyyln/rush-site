"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { adminApi, errorMessage } from "../_lib/client";
import { ago } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import { ConfirmDialog, Section } from "../_components/parts";
import styles from "../admin.module.css";

// Whether game servers record and upload a demo. Off until an admin turns it on
export function DemoRecording() {
  const toast = useToast();
  const now = useNow(30_000);
  const live = useLiveData(() => adminApi.demoRecording(), [], { kinds: ["host"], pollMs: 60_000 });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = live.data;

  async function set(enabled: boolean) {
    setBusy(true);
    try {
      await adminApi.setDemoRecording(enabled);
      toast.push({ title: `Demo recording ${enabled ? "on" : "off"}`, body: "Applies to servers started from now on.", tone: enabled ? "success" : "info" });
      live.reload();
    } finally {
      setBusy(false);
    }
  }

  const toggle = () => {
    if (!s) return;
    // Without storage every upload fails, so switching on asks first
    if (!s.enabled && !s.s3Configured) return setConfirming(true);
    void set(!s.enabled).catch((e) => toast.push({ title: "Could not change demo recording", body: errorMessage(e), tone: "error" }));
  };

  return (
    <Section title="Demo recording">
      <ul className={styles.toggles}>
        <li className={styles.toggle}>
          <div className={styles.toggleText}>
            <span className={styles.toggleName}>Record demos</span>
            {s ? <Badge tone={s.enabled ? "win" : "neutral"}>{s.enabled ? "On" : "Off"}</Badge> : <span className={styles.muted}>--</span>}
            {s && <Badge tone={s.s3Configured ? "info" : "warn"}>{s.s3Configured ? "S3 configured" : "S3 not configured"}</Badge>}
            {s?.updatedAt && (
              <span className={styles.muted}>
                Changed {ago(s.updatedAt, now)}
              </span>
            )}
          </div>
          <Button variant={s?.enabled ? "secondary" : "primary"} disabled={!s} loading={busy} onClick={toggle}>
            {s?.enabled ? "Turn off" : "Turn on"}
          </Button>
        </li>
      </ul>
      <p className={styles.muted}>
        When off, servers skip tv_record and nothing is uploaded. Demos need S3 storage on the api before switching on. Running matches keep the
        setting they started with.
      </p>
      {live.error && !s && <p className={styles.loss}>Could not load the demo setting. {errorMessage(live.error)}</p>}
      <ConfirmDialog
        open={confirming}
        title="Turn demo recording on without S3?"
        body="S3 storage is not configured on the api. Servers will record demos, every upload will fail and the files stay on the game host."
        confirmLabel="Turn on anyway"
        danger
        onClose={() => setConfirming(false)}
        onConfirm={() => set(true)}
      />
    </Section>
  );
}
