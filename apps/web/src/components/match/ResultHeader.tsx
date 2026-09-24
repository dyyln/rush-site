import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { mmss } from "@/lib/format";
import type { MatchDetail } from "@/lib/types";
import { mvpReason, type Roster } from "./roster";
import styles from "./ResultHeader.module.css";

type Props = {
  m: MatchDetail;
  roster: Roster;
  ownIndex: number;
  viewer?: string | null;
  sideOf: (i: number) => TeamSide;
};

// The score in the page header: both teams either side of it, and once the match is over the result,
// how long it took and the MVP. In a series the score is maps won
export function ResultHeader({ m, roster, ownIndex, viewer, sideOf }: Props) {
  const [a, b] = m.teams;
  if (!a || !b) return null;
  const finished = m.status === "finished";
  const draw = a.score === b.score;
  const winner = a.score > b.score ? a : b;
  const played = m.teams.some((t) => t.players.some((p) => p.steamId === viewer));
  const ownWon = !draw && m.teams[ownIndex] === winner;
  const headline = draw ? "Draw" : played ? (ownWon ? "Victory" : "Defeat") : `${winner.displayName ?? winner.name} won`;
  const duration = m.startedAt && m.endedAt ? mmss((new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) / 1000) : null;
  const mvp = m.mvp ? roster.get(m.mvp.steamId) : undefined;

  return (
    <div className={styles.result}>
      <div className={styles.strip} aria-label="Score" role="group">
        <Team team={a} side={sideOf(0)} align="end" />
        <p className={styles.score}>
          <span data-side={sideOf(0)}>{a.score}</span>
          <span className={styles.dash} aria-hidden="true">
            :
          </span>
          <span data-side={sideOf(1)}>{b.score}</span>
          <span className="visually-hidden">
            {", "}
            {a.displayName ?? a.name} {a.score}, {b.displayName ?? b.name} {b.score}
          </span>
        </p>
        <Team team={b} side={sideOf(1)} align="start" />
      </div>

      {finished && (
        <div className={styles.line}>
          <h2 className={styles.headline} data-result={draw ? "draw" : played ? (ownWon ? "win" : "loss") : "neutral"}>
            {headline}
          </h2>
          {duration && (
            <span className={styles.meta}>
              <span className="mono">{duration}</span> played
            </span>
          )}
          {mvp && m.mvp && (
            <span className={styles.mvp} data-side={mvp.side} title={mvpReason(m.mvp.reason, mvp.player)}>
              <span className={styles.mvpTag}>MVP</span>
              <TeamMarker side={mvp.side} />
              <Link href={`/profile/${mvp.player.steamId}`}>{mvp.player.displayName}</Link>
              <span className="visually-hidden">, {mvpReason(m.mvp.reason, mvp.player)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Team({ team, side, align }: { team: MatchDetail["teams"][number]; side: TeamSide; align: "start" | "end" }) {
  return (
    <div className={styles.team} data-align={align}>
      <span className={styles.teamName} data-side={side}>
        <TeamMarker side={side} />
        <span className={styles.ellipsis}>{team.displayName ?? team.name}</span>
      </span>
      <span className={styles.avatars}>
        {team.players.map((p) => (
          <Link key={p.steamId} href={`/profile/${p.steamId}`} title={p.displayName} className={styles.avatarLink}>
            <Avatar name={p.displayName} src={p.avatarUrl} size="sm" />
            <span className="visually-hidden">{p.displayName}</span>
          </Link>
        ))}
      </span>
    </div>
  );
}
