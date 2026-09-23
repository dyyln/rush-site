"use client";

import { useId, useSyncExternalStore } from "react";
import { cx } from "@/components/ui/cx";
import styles from "./LocalTime.module.css";

const OPTS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};
const utcFmt = new Intl.DateTimeFormat("en-GB", { ...OPTS, timeZone: "UTC" });
let localFmt: Intl.DateTimeFormat | null = null;

function local(d: Date): string {
  localFmt ??= new Intl.DateTimeFormat("en-GB", {
    ...OPTS,
    timeZoneName: "short",
  });
  return localFmt.format(d);
}

const noop = () => () => {};

// The server has no idea of the viewer's zone. Render UTC there and switch after hydration
function useIsClient(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

type LocalTimeProps = {
  iso: string;
  // Which edge the tooltip lines up with
  align?: "start" | "end";
  className?: string;
};

// Local time with the UTC time in a tooltip on hover or focus
export function LocalTime({ iso, align = "start", className }: LocalTimeProps) {
  const client = useIsClient();
  const id = useId();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const utc = utcFmt.format(d);
  return (
    <span className={cx(styles.wrap, className)} tabIndex={0} aria-describedby={id}>
      <time dateTime={iso}>{client ? local(d) : `${utc} UTC`}</time>
      <span id={id} role="tooltip" className={cx(styles.tip, align === "end" && styles.end)}>
        <span className={styles.tag}>UTC</span>
        <span className="mono">{utc}</span>
      </span>
    </span>
  );
}
