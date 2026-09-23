import Link from "next/link";
import type { ServiceStatus } from "@rushsite/shared";
import { MODE_COPY } from "@/lib/modes";
import { unavailableText } from "./copy";
import styles from "./ModeAvailabilityHint.module.css";

// Lists modes that cannot queue right now with a link to the status page
export function ModeAvailabilityHint({ status }: { status: ServiceStatus | null }) {
  const down = status?.modes.filter((m) => !m.available) ?? [];
  if (down.length === 0) return null;
  return (
    <p className={styles.hint} role="status">
      {down.map((m, i) => (
        <span key={m.mode}>
          {i > 0 && ". "}
          {MODE_COPY[m.mode].label} unavailable: {unavailableText(m.reason).toLowerCase()}
        </span>
      ))}
      .{" "}
      <Link href="/status" className={styles.link}>
        Server status
      </Link>
    </p>
  );
}
