"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Throbber } from "@/components/ui/Throbber";
import { TierChip } from "@/components/ui/TierChip";
import { ApiError } from "@/lib/api";
import { mapName, modeLabel } from "@/lib/modes";
import type { MatchDetail, MatchPlayer, MatchRound, MatchStatus } from "@/lib/types";
import { useMatch } from "@/lib/useMatch";
import styles from "./match.module.css";

const STATUS: Record<MatchStatus, { label: string; tone: "win" | "neutral" | "loss" | "info" }> = {
  pending: { label: "Starting", tone: "info" },
  live: { label: "Live", tone: "win" },
  completed: { label: "Finished", tone: "neutral" },
  abandoned: { label: "Abandoned", tone: "loss" },
  cancelled: { label: "Cancelled", tone: "loss" },
};

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
  const status = STATUS[m.status];
  const [a, b] = m.teams;
  return (
    <div className="container page">
      <header className={styles.header}>
        <div className="row">
          <Badge tone={status.tone}>
            {m.status === "live" && <Throbber />}
            {status.label}
          </Badge>
          <span className="eyebrow">{modeLabel(m.mode)}</span>
          <span className="mono muted">{mapName(m.mode, m.mapId)}</span>
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

      {a && b && (
        <section className={styles.scoreboard} aria-label="Score">
          <TeamScore team={a} side="a" />
          <span className={styles.dash} aria-hidden="true">
            :
          </span>
          <TeamScore team={b} side="b" />
        </section>
      )}

      {a && b && <Timeline rounds={m.rounds} teamA={a.name} teamB={b.name} rush={m.mode === "rush3v3"} />}

      <div className={styles.tables}>
        {m.teams.map((t, i) => (
          <section key={t.name} aria-labelledby={`team-${i}`} className="stack">
            <h2 id={`team-${i}`} className={styles.teamHeading}>
              <span className={styles.swatch} data-side={i === 0 ? "a" : "b"} aria-hidden="true" />
              {t.name}
            </h2>
            <Table caption={`${t.name} players`} columns={playerColumns} rows={t.players} rowKey={(p) => p.steamId} />
          </section>
        ))}
      </div>
    </div>
  );
}

function TeamScore({ team, side }: { team: MatchDetail["teams"][number]; side: "a" | "b" }) {
  return (
    <div className={styles.team} data-side={side}>
      <span className={styles.score}>{team.score}</span>
      <span className={styles.teamName}>{team.name}</span>
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

function Timeline({ rounds, teamA, teamB, rush }: { rounds: MatchRound[]; teamA: string; teamB: string; rush: boolean }) {
  if (rounds.length === 0) return <p className="muted">No rounds yet.</p>;
  return (
    <section aria-labelledby="rounds-heading" className="stack">
      <h2 id="rounds-heading" className={styles.sub}>
        Rounds
      </h2>
      <ol className={styles.timeline}>
        {rounds.map((r, i) => {
          const next = rounds[i + 1];
          const streakEnd = !next || next.winnerTeam !== r.winnerTeam;
          const side = r.winnerTeam === teamA ? "a" : "b";
          const score = `${r.score[teamA] ?? 0}:${r.score[teamB] ?? 0}`;
          const label = `Round ${r.round}, ${r.winnerTeam}, ${score}${rush && r.arena ? `, ${r.arena}` : ""}`;
          return (
            <li key={r.round} className={styles.round} title={label}>
              <span className={styles.seg} data-side={side} />
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

const playerColumns: Column<MatchPlayer>[] = [
  {
    key: "player",
    header: "Player",
    cell: (p) => (
      <span className={styles.player}>
        <Link href={`/profile/${p.steamId}`} className={styles.playerName}>
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
