import type { Mode } from "@rushsite/shared";
import { cx } from "@/components/ui/cx";
import { formatStat, pct, winRate } from "@/lib/format";
import { mapName } from "@/lib/modes";
import type { MapStat } from "@/lib/types";
import styles from "./BestMaps.module.css";

// Below this many matches a win rate says little, so the row is shown but toned down
export const SMALL_SAMPLE = 10;

// Maps with a real sample first by win rate, then small samples by matches played
function order(a: MapStat, b: MapStat): number {
  const sa = a.matches < SMALL_SAMPLE;
  const sb = b.matches < SMALL_SAMPLE;
  if (sa !== sb) return sa ? 1 : -1;
  if (sa) return b.matches - a.matches || winRate(b.wins, b.matches) - winRate(a.wins, a.matches);
  return winRate(b.wins, b.matches) - winRate(a.wins, a.matches) || b.matches - a.matches;
}

export function BestMaps({ mode, maps }: { mode: Mode; maps: MapStat[] }) {
  if (maps.length === 0) return <p className="muted">Not enough matches.</p>;
  return (
    <ol className={styles.list}>
      {[...maps].sort(order).map((m) => {
        const wr = winRate(m.wins, m.matches);
        const small = m.matches < SMALL_SAMPLE;
        return (
          <li key={m.mapId} className={cx(styles.row, small && styles.small)}>
            <span className={styles.head}>
              <span className={cx("mono", styles.name)}>{mapName(mode, m.mapId)}</span>
              <span className={cx("mono", styles.rate)}>
                {formatStat(wr, "pct", m.matches)}
                <span className="visually-hidden"> win rate</span>
              </span>
            </span>
            <span className={styles.bar} aria-hidden="true">
              <span style={{ width: pct(wr) }} />
            </span>
            <span className={styles.meta}>
              <span className="mono">
                {m.wins}W {m.matches - m.wins}L
              </span>
              <span>
                <span className="mono">{m.matches}</span> {m.matches === 1 ? "match" : "matches"}
                {small && ", small sample"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
