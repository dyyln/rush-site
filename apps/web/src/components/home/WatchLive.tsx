"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import { useServiceStatus } from "@/components/stats/useServiceStatus";
import { mapName, MODE_COPY } from "@/lib/modes";
import { useAsync } from "@/lib/useAsync";
import { fetchLiveMatches, type LiveMatch } from "./data";
import styles from "./home.module.css";

const REFRESH_MS = 30_000;

export function WatchLive() {
  const data = useAsync(() => fetchLiveMatches(6), []);
  const { reload } = data;
  const status = useServiceStatus();
  const canQueue = !status || status.modes.some((m) => m.available);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  // Keeps the last list on screen while a refresh loads
  const rows = useLastSuccess(data);

  return (
    <section className={styles.section} aria-labelledby="watch-live">
      <div className={styles.sectionHead}>
        <h2 id="watch-live" className={styles.sectionTitle}>
          Watch live
        </h2>
      </div>
      {rows === null && data.status === "loading" && <p className="muted">Loading</p>}
      {rows === null && data.status === "error" && <p className="muted">Live matches are unavailable right now.</p>}
      {rows !== null &&
        (rows.length === 0 ? (
          <p className="muted">
            {canQueue ? "No matches in progress. Queue up and be the first." : "No matches in progress. Matches start once servers are open."}
          </p>
        ) : (
          <ul className={styles.live}>
            {rows.map((m) => (
              <li key={m.id}>
                <LiveRow m={m} />
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function useLastSuccess(data: { status: string; data?: LiveMatch[] }): LiveMatch[] | null {
  const last = useRef<LiveMatch[] | null>(null);
  if (data.status === "success" && data.data) last.current = data.data;
  return last.current;
}

function LiveRow({ m }: { m: LiveMatch }) {
  const [a, b] = m.teams;
  const side = (t: typeof a, fallback: string) =>
    t ? (t.players.length > 0 ? t.players.join(", ") : t.name) : fallback;
  const label = `${MODE_COPY[m.mode].label}${m.mapId ? `, ${mapName(m.mode, m.mapId)}` : ""}: ${side(a, "Team A")} ${a?.score ?? 0} to ${b?.score ?? 0} ${side(b, "Team B")}`;
  return (
    <Link href={`/matches/${m.id}`} className={styles.liveRow} aria-label={label}>
      <span className={styles.liveMeta}>
        <Badge tone="win">Live</Badge>
        <span className={styles.liveMode}>{MODE_COPY[m.mode].label}</span>
        {m.mapId && <span className={`mono ${styles.liveMap}`}>{mapName(m.mode, m.mapId)}</span>}
      </span>
      <span className={styles.liveScore} aria-hidden="true">
        <span className={styles.liveTeamA}>{side(a, "Team A")}</span>
        <span className={`mono ${styles.liveNums}`}>
          {a?.score ?? 0}
          <span className={styles.liveDash}>:</span>
          {b?.score ?? 0}
        </span>
        <span className={styles.liveTeamB}>{side(b, "Team B")}</span>
      </span>
      {m.tournamentName && <span className={styles.liveCup}>{m.tournamentName}</span>}
    </Link>
  );
}
