"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Throbber } from "@/components/ui/Throbber";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { TierChip } from "@/components/ui/TierChip";
import { ApiError } from "@/lib/api";
import { mapName, modeLabel } from "@/lib/modes";
import type { MatchDetail, MatchPlayer, MatchRound, MatchStatus } from "@/lib/types";
import { useMatch } from "@/lib/useMatch";
import { useSession } from "@/lib/session";
import styles from "./match.module.css";

const STATUS: Record<MatchStatus, { label: string; tone: "win" | "neutral" | "loss" | "info" }> = {
  accepting: { label: "Accepting", tone: "info" },
  veto: { label: "Veto", tone: "info" },
  allocating: { label: "Starting", tone: "info" },
  starting: { label: "Starting", tone: "info" },
  ready: { label: "Ready", tone: "info" },
  live: { label: "Live", tone: "win" },
  finished: { label: "Finished", tone: "neutral" },
  abandoned: { label: "Abandoned", tone: "loss" },
  cancelled: { label: "Cancelled", tone: "loss" },
};

const CONNECTABLE: MatchStatus[] = ["starting", "ready", "live"];

export function MatchView({ id }: { id: string }) {
  const { match, error } = useMatch(id);
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="container page">
        <Card title={notFound ? "Match not found" : "Could not load match"}>
          <p className="muted">Check the link and try again.</p>
        </Card>
      </div>
    );
  }
  if (!match) {
    return (
      <div className="container page" aria-busy="true">
        <p className="muted">Loading match</p>
      </div>
    );
  }
  return <MatchBody m={match} />;
}

function MatchBody({ m }: { m: MatchDetail }) {
  const { user } = useSession();
  const status = STATUS[m.status];
  const [a, b] = m.teams;
  // The viewer's team is own. A neutral viewer sees the first team as own
  const mine = m.teams.findIndex((t) => t.players.some((p) => p.steamId === user?.steamId));
  const ownIndex = mine === -1 ? 0 : mine;
  const sideOf = (i: number): TeamSide => (i === ownIndex ? "own" : "enemy");
  return (
    <div className="container page">
      <header className={styles.header}>
        <div className="row">
          <Badge tone={status.tone}>
            {m.status === "live" && <Throbber />}
            {status.label}
          </Badge>
          <span className="eyebrow">{modeLabel(m.mode)}</span>
          {m.mapId && <span className="mono muted">{mapName(m.mode, m.mapId)}</span>}
        </div>
        {m.tournament && (
          <p className={styles.cup}>
            <Link href={`/tournaments/${m.tournament.id}`}>{m.tournament.name}</Link>
            <span className="muted">
              {" "}
              Game {m.tournament.gameNumber} of Bo{m.tournament.bestOf}
            </span>
          </p>
        )}
      </header>

      {m.connect && CONNECTABLE.includes(m.status) && (
        <Card tone="accent" eyebrow="You are in this match" title="Connect">
          <div className="row">
            <a className={styles.connect} href={`steam://connect/${m.connect.ip}:${m.connect.port}/${encodeURIComponent(m.connect.password)}`}>
              Launch CS2 and connect
            </a>
            <code className="mono muted">{m.connect.connect}</code>
          </div>
        </Card>
      )}

      {a && b && (
        <section className={styles.scoreboard} aria-label="Score">
          <TeamScore team={a} side={sideOf(0)} />
          <span className={styles.dash} aria-hidden="true">
            :
          </span>
          <TeamScore team={b} side={sideOf(1)} />
        </section>
      )}

      {a && b && <Timeline rounds={m.rounds} teamA={a.name} teamB={b.name} sideA={sideOf(0)} rush={m.mode === "rush3v3"} />}

      <div className={styles.tables}>
        {m.teams.map((t, i) => (
          <section key={t.name} aria-labelledby={`team-${i}`} className="stack">
            <h2 id={`team-${i}`} className={styles.teamHeading}>
              <TeamMarker side={sideOf(i)} />
              {t.name}
            </h2>
            <Table caption={`${t.name} players`} columns={playerColumns(sideOf(i))} rows={t.players} rowKey={(p) => p.steamId} />
          </section>
        ))}
      </div>
    </div>
  );
}

function TeamScore({ team, side }: { team: MatchDetail["teams"][number]; side: TeamSide }) {
  return (
    <div className={styles.team} data-side={side}>
      <span className={styles.score}>{team.score}</span>
      <span className={styles.teamName}>
        <TeamMarker side={side} />
        {team.name}
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

function Timeline({
  rounds,
  teamA,
  teamB,
  sideA,
  rush,
}: {
  rounds: MatchRound[];
  teamA: string;
  teamB: string;
  sideA: TeamSide;
  rush: boolean;
}) {
  if (rounds.length === 0) return <p className="muted">No rounds yet.</p>;
  let lastTick = -99;
  return (
    <section aria-labelledby="rounds-heading" className="stack">
      <h2 id="rounds-heading" className={styles.sub}>
        Rounds
      </h2>
      <svg width="0" height="0" className={styles.defs} aria-hidden="true" focusable="false">
        <defs>
          <pattern id="team-enemy-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="currentColor" opacity="0.45" />
            <rect width="3" height="6" fill="currentColor" />
          </pattern>
        </defs>
      </svg>
      <ol className={styles.timeline}>
        {rounds.map((r, i) => {
          const next = rounds[i + 1];
          // Label the score where a streak ends, spaced out so labels do not collide
          const streakEnd = (!next || next.winnerTeam !== r.winnerTeam) && (!next || r.round - lastTick >= 3);
          if (streakEnd) lastTick = r.round;
          const side: TeamSide = r.winnerTeam === teamA ? sideA : sideA === "own" ? "enemy" : "own";
          const score = `${r.score[teamA] ?? 0}:${r.score[teamB] ?? 0}`;
          const label = `Round ${r.round}, ${r.winnerTeam}, ${score}${rush && r.arena ? `, ${r.arena}` : ""}`;
          return (
            <li key={r.round} className={styles.round} title={label}>
              {side === "own" ? (
                <span className={styles.seg} data-side="own" />
              ) : (
                <svg className={styles.seg} data-side="enemy" aria-hidden="true" focusable="false">
                  <rect width="100%" height="100%" fill="url(#team-enemy-hatch)" />
                </svg>
              )}
              <span className="visually-hidden">{label}</span>
              {streakEnd && (
                <span className={`${styles.tick} mono`} aria-hidden="true">
                  {score}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const playerColumns = (side: TeamSide): Column<MatchPlayer>[] => [
  {
    key: "player",
    header: "Player",
    cell: (p) => (
      <span className={styles.player}>
        <Link href={`/profile/${p.steamId}`} className={styles.playerName}>
          <TeamMarker side={side} />
          {p.displayName}
        </Link>
        <TierChip tier={p.tier} rating={p.rating} size="sm" />
      </span>
    ),
  },
  { key: "k", header: "K", cell: (p) => p.kills, numeric: true },
  { key: "d", header: "D", cell: (p) => p.deaths, numeric: true },
  { key: "hs", header: "HS", cell: (p) => p.headshots, numeric: true },
  { key: "dmg", header: "DMG", cell: (p) => p.damage, numeric: true },
];
