import type { BadgeKind, CupCadence } from "@/lib/types";
import { cx } from "@/components/ui/cx";
import styles from "./CupBadges.module.css";

// Cup trophy. The placing is written on the bowl (1, 2, T4), weekly cups stand on a stepped
// plinth and special cups carry a gem, so neither placing nor cadence relies on colour alone.
// Under 28 px the number becomes a mark: a star for champion, two bars for runner-up, one for top 4.
// Decorative only, the placing is always written next to it.
const MARK: Record<BadgeKind, string> = { cup_champion: "1", cup_runner_up: "2", cup_semifinalist: "T4" };

// The badge carries no cadence, so it is read from the cup's name. Anything not named daily or
// weekly counts as a special event
export function cadenceFromName(name: string): CupCadence {
  if (/\bweekly\b/i.test(name)) return "weekly";
  if (/\bdaily\b/i.test(name)) return "daily";
  return "special";
}

export function BadgeEmblem({
  kind,
  cadence = "daily",
  size = 48,
  className,
}: {
  kind: BadgeKind;
  cadence?: CupCadence;
  size?: number;
  className?: string;
}) {
  const small = size < 28;
  const mark = MARK[kind];
  return (
    <svg
      viewBox="0 0 40 48"
      width={Math.round((size * 40) / 48)}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx(styles.emblem, className)}
      data-kind={kind}
    >
      <path d="M8 6H3v5c0 5 3.5 8 7 8.5M32 6h5v5c0 5-3.5 8-7 8.5" className={styles.emblemHandle} />
      <path d="M8 3h24v10c0 8-5 13-12 13S8 21 8 13Z" className={styles.emblemBody} />
      <path d="M18 26h4v6h-4Z" className={styles.emblemMark} />
      {cadence === "weekly" ? (
        <g className={styles.emblemMark}>
          <rect x="12" y="32" width="16" height="4" />
          <rect x="9" y="37" width="22" height="4" opacity={0.8} />
          <rect x="6" y="42" width="28" height="4" opacity={0.6} />
        </g>
      ) : (
        <rect x="11" y="32" width="18" height="5" className={styles.emblemMark} />
      )}
      {cadence === "special" && <path d="M20 0l3.2 3.2L20 6.4l-3.2-3.2Z" className={styles.emblemGem} />}
      {!small && (
        <text x="20" y="15" textAnchor="middle" dominantBaseline="middle" className={cx(styles.emblemText, mark.length > 1 && styles.emblemTextSm)}>
          {mark}
        </text>
      )}
      {small && (
        <g className={styles.emblemMark} transform="translate(0 -16)">
          {kind === "cup_champion" && <path d="m20 24.5 2 4 4.4.5-3.2 3 .8 4.4-4-2.2-4 2.2.8-4.4-3.2-3 4.4-.5Z" />}
          {kind === "cup_runner_up" && <path d="M13 27h14v3H13Z M13 32h14v3H13Z" />}
          {kind === "cup_semifinalist" && <path d="M13 29.5h14v3H13Z" />}
        </g>
      )}
    </svg>
  );
}
