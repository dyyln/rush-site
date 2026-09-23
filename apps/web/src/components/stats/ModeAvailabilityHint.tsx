import type { ServiceStatus } from "@rushsite/shared";
import { ButtonLink } from "@/components/ui/Button";
import { MODE_COPY } from "@/lib/modes";
import { unavailableText } from "./copy";
import { WarningIcon } from "./WarningIcon";
import styles from "./ModeAvailabilityHint.module.css";

// Notice card for modes that cannot queue right now
export function ModeAvailabilityHint({ status }: { status: ServiceStatus | null }) {
  const down = status?.modes.filter((m) => !m.available) ?? [];
  if (!status || down.length === 0) return null;
  const allSame = down.length === status.modes.length && down.every((m) => m.reason === down[0]!.reason);
  const lines = allSame
    ? [{ key: "all", text: `All modes unavailable: ${unavailableText(down[0]!.reason).toLowerCase()}` }]
    : down.map((m) => ({ key: m.mode, text: `${MODE_COPY[m.mode].label}: ${unavailableText(m.reason)}` }));
  return (
    <div className={styles.card} role="status">
      <ul className={styles.lines}>
        {lines.map((l) => (
          <li key={l.key} className={styles.line}>
            <WarningIcon className={styles.icon} />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
      <div>
        <ButtonLink href="/status" variant="secondary">
          Server status
        </ButtonLink>
      </div>
    </div>
  );
}
