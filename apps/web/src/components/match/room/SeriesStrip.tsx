"use client";

import type { MatchMap, Mode } from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import type { TeamSide } from "@/components/ui/TeamMarker";
import { DemoActions } from "@/components/match/DemoActions";
import { cx } from "@/components/ui/cx";
import { mapName } from "@/lib/modes";
import styles from "./Room.module.css";

const STATUS_LABEL: Record<MatchMap["status"], string> = { upcoming: "Upcoming", live: "Live", done: "Done" };

type Team = { name: string; label: string; side: TeamSide };

// One card per map of a series. The live map is outlined, done maps carry their demo
export function SeriesStrip({
  matchId,
  mode,
  bestOf,
  maps,
  teams,
  wins,
}: {
  matchId: string;
  mode: Mode;
  bestOf: number;
  maps: MatchMap[];
  teams: [Team, Team];
  // Maps won per team name
  wins: Record<string, number>;
}) {
  const [a, b] = teams;
  return (
    <section className={styles.series} aria-labelledby="series-heading">
      <div className={styles.seriesHead}>
        <h2 id="series-heading" className={styles.seriesTitle}>
          Best of {bestOf}
        </h2>
        <p className="mono" aria-label={`Maps won. ${a.label} ${wins[a.name] ?? 0}, ${b.label} ${wins[b.name] ?? 0}`}>
          {a.label} {wins[a.name] ?? 0} : {wins[b.name] ?? 0} {b.label}
        </p>
      </div>
      <ol className={styles.maps}>
        {maps.map((m) => (
          <li key={m.mapNumber} className={cx("glass", styles.map)} data-status={m.status} aria-current={m.status === "live" ? "step" : undefined}>
            <div className={styles.mapTop}>
              <span>
                <span className="muted">Map {m.mapNumber} </span>
                <span className={styles.mapName}>{mapName(mode, m.mapId)}</span>
              </span>
              <Badge tone={m.status === "live" ? "win" : m.status === "done" ? "neutral" : "info"}>{STATUS_LABEL[m.status]}</Badge>
            </div>
            {m.status !== "upcoming" && (
              <p className={styles.mapScore}>
                <span data-side={a.side}>{m.score[a.name] ?? 0}</span>
                <span aria-hidden="true"> : </span>
                <span className="visually-hidden"> to </span>
                <span data-side={b.side}>{m.score[b.name] ?? 0}</span>
                {m.winnerTeam && <span className="visually-hidden">. Won by {m.winnerTeam === a.name ? a.label : b.label}</span>}
              </p>
            )}
            {m.status === "done" && m.demo && (
              <div className={styles.mapActions}>
                <DemoActions matchId={matchId} demo={m.demo} mapNumber={m.mapNumber} label={`Map ${m.mapNumber} demo`} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
