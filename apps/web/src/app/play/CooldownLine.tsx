"use client";

import type { QueueCooldown } from "@rushsite/shared";
import { useNow } from "@/components/play/useNow";
import { mmss } from "@/lib/format";
import styles from "./play.module.css";

const REASON: Record<QueueCooldown["reason"], string> = {
  decline: "declining",
  accept_timeout: "missing the accept window",
  no_connect: "not connecting",
  abandon: "leaving a match",
};

// Hours and minutes for long abandon cooldowns, m:ss below an hour
export function cooldownLeft(sec: number): string {
  if (sec < 3600) return mmss(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

export function cooldownText(cd: QueueCooldown | undefined, sec: number | null): string {
  const left = sec === null ? "--:--" : cooldownLeft(sec);
  if (!cd) return `Cooldown, ${left} left`;
  return `Cooldown for ${REASON[cd.reason]}, step ${cd.step} of ${cd.steps}, ${left} left`;
}

// Lasting line next to Start while a queue cooldown runs
export function CooldownLine({ until, cooldown }: { until: number; cooldown?: QueueCooldown }) {
  const now = useNow(true, 1000);
  const sec = now === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <p className={styles.cooldownLine}>
      <span className="visually-hidden">Queue </span>
      {cooldownText(cooldown, sec)}
    </p>
  );
}
