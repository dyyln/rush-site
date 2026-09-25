"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { isRushMode, type LiveMatch } from "@rushsite/shared";
import { cx } from "@/components/ui/cx";
import { api } from "@/lib/api";
import { mapName, MODE_COPY } from "@/lib/modes";
import { useAsync } from "@/lib/useAsync";
import styles from "./LiveMatches.module.css";

const LIMIT = 5;
const REFRESH_MS = 30_000;

// Matches being played now, below the queues on Play. Refreshes while the tab is visible
export function LiveMatches() {
  const data = useAsync(() => api.liveMatches(LIMIT), []);
  const { reload } = data;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  // Keeps the last list on screen while a refresh loads
  const last = useRef<LiveMatch[] | null>(null);
  if (data.status === "success") last.current = data.data;
  const rows = last.current;

  return (
    <section className={cx("glass", styles.panel)} aria-labelledby="live-matches">
      <h2 id="live-matches" className={styles.head}>
        <span className={styles.dot} aria-hidden="true" />
        Live matches
      </h2>
      {rows === null ? (
        <p className={styles.note}>{data.status === "error" ? "Live matches are unavailable right now." : "Loading"}</p>
      ) : rows.length === 0 ? (
        <p className={styles.note}>No matches in progress right now.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((m) => (
            <li key={m.id}>
              <LiveRow m={m} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveRow({ m }: { m: LiveMatch }) {
  const copy = MODE_COPY[m.mode];
  const [a, b] = m.teams;
  const names = (t: LiveMatch["teams"][number] | undefined, fallback: string) =>
    t ? (t.players.length > 0 ? t.players.map((p) => p.displayName).join(", ") : t.name) : fallback;
  // Rush has one map, so only aim matches name theirs
  const map = m.mapId && !isRushMode(m.mode) ? mapName(m.mode, m.mapId) : null;
  const label = `${copy.format} ${copy.name}${map ? ` on ${map}` : ""}${m.tournament ? `, ${m.tournament.name}` : ""}: ${names(a, "Team A")} ${a?.score ?? 0} to ${b?.score ?? 0} ${names(b, "Team B")}`;
  return (
    <Link href={`/matches/${m.id}`} className={styles.row} aria-label={label}>
      <span className={styles.meta} aria-hidden="true">
        <span className={styles.mode}>
          <span className={styles.format}>{copy.format}</span> {copy.name}
        </span>
        {map && <span className={cx("mono", styles.sub)}>{map}</span>}
        {m.tournament && <span className={styles.sub}>{m.tournament.name}</span>}
      </span>
      <span className={styles.score} aria-hidden="true">
        <span className={styles.teamA}>{names(a, "Team A")}</span>
        <span className={cx("mono", styles.nums)}>
          {a?.score ?? 0}
          <span className={styles.colon}>:</span>
          {b?.score ?? 0}
        </span>
        <span className={styles.teamB}>{names(b, "Team B")}</span>
      </span>
    </Link>
  );
}
