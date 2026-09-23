"use client";

import { useEffect, useId, useState } from "react";
import { playCue } from "./cues";
import { notificationPermission, useNotifySettings, type PermissionState } from "./settings";
import styles from "./notify.module.css";

type ToggleProps = {
  label: string;
  hint: string;
  checked: boolean;
  busy?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
};

export function Toggle({ label, hint, checked, busy, disabled, onChange }: ToggleProps) {
  const id = useId();
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span id={`${id}-l`} className={styles.label}>
          {label}
        </span>
        <span id={`${id}-h`} className={styles.hint}>
          {hint}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={`${id}-h`}
        aria-busy={busy || undefined}
        disabled={busy || disabled}
        className={styles.switch}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </div>
  );
}

export function NotifyPanel() {
  const [settings, update] = useNotifySettings();
  const [permission, setPermission] = useState<PermissionState>("default");
  const [asking, setAsking] = useState(false);

  useEffect(() => setPermission(notificationPermission()), []);

  const browserOn = settings.browser && permission === "granted";

  async function toggleBrowser(next: boolean) {
    if (!next) return update({ browser: false });
    if (permission === "unsupported") return;
    let result: NotificationPermission = Notification.permission;
    if (result === "default") {
      setAsking(true);
      try {
        result = await Notification.requestPermission();
      } catch {
        result = Notification.permission;
      }
      setAsking(false);
    }
    setPermission(result);
    update({ browser: result === "granted" });
  }

  const browserHint =
    permission === "unsupported"
      ? "This browser does not support notifications."
      : permission === "denied"
        ? "Blocked in your browser settings. Allow notifications for this site to turn this on."
        : "Alerts you when this tab is in the background.";

  return (
    <div className={styles.panel}>
      <Toggle
        label="Match found sound"
        hint="Plays when a match is found and when the server is ready."
        checked={settings.sound}
        onChange={(sound) => {
          update({ sound });
          if (sound) playCue("match_found");
        }}
      />
      <Toggle
        label="Browser notifications"
        hint={browserHint}
        checked={browserOn}
        busy={asking}
        disabled={permission === "unsupported" || (permission === "denied" && !browserOn)}
        onChange={(v) => void toggleBrowser(v)}
      />
      <button type="button" className={styles.test} onClick={() => playCue("match_found")} disabled={!settings.sound}>
        Test sound
      </button>
    </div>
  );
}
