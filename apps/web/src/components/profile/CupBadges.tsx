import Link from "next/link";
import { cx } from "@/components/ui/cx";
import { shortDate } from "@/lib/format";
import { modeLabel } from "@/lib/modes";
import type { BadgeKind, ProfileBadge } from "@/lib/types";
import { BadgeEmblem } from "./BadgeEmblem";
import styles from "./CupBadges.module.css";

const PLACING: Record<BadgeKind, { title: string; place: string; rank: number }> = {
  cup_champion: { title: "Champion", place: "1st place", rank: 0 },
  cup_runner_up: { title: "Runner-up", place: "2nd place", rank: 1 },
  cup_semifinalist: { title: "Semifinalist", place: "Top 4", rank: 2 },
};

// Newest first, the better placing first on the same day
function order(a: ProfileBadge, b: ProfileBadge): number {
  return Date.parse(b.awardedAt) - Date.parse(a.awardedAt) || PLACING[a.kind].rank - PLACING[b.kind].rank;
}

export function CupBadges({ badges }: { badges: ProfileBadge[] }) {
  if (badges.length === 0) return <p className="muted">No cup placings yet.</p>;
  return (
    <ul className={styles.grid}>
      {[...badges].sort(order).map((b) => {
        const p = PLACING[b.kind];
        return (
          <li key={b.id} className={cx("glass", styles.badge)} data-kind={b.kind}>
            <BadgeEmblem kind={b.kind} />
            <span className={styles.text}>
              <span className={styles.title}>
                {p.title}
                <span className={styles.place}>{p.place}</span>
              </span>
              <Link href={`/tournaments/${b.tournamentId}`} className={styles.cup}>
                {b.tournamentName}
              </Link>
              <span className={styles.meta}>
                {modeLabel(b.mode)}
                <span aria-hidden="true"> / </span>
                <span className="visually-hidden">, </span>
                <time dateTime={b.awardedAt} className="mono">
                  {shortDate(b.awardedAt)}
                </time>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
