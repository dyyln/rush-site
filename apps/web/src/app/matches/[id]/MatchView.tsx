"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Table, type Column } from "@/components/ui/Table";
import { Throbber } from "@/components/ui/Throbber";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { TierChip } from "@/components/ui/TierChip";
import { MatchSkeleton } from "@/components/skeletons/MatchSkeleton";
import { ConnectSteps, type ConnectStep } from "@/components/match/ConnectSteps";
import { DemoActions } from "@/components/match/DemoActions";
import { MatchSummary } from "@/components/match/MatchSummary";
import { ReportButton } from "@/components/match/ReportDialog";
import { RoundTimeline } from "@/components/match/RoundTimeline";
import { MatchReportOutcomes } from "@/components/review/MatchReportOutcomes";
import { ShareButton } from "@/components/match/ShareButton";
import { RematchButton } from "@/components/challenges/RematchButton";
import { buildRoster, ownTeamIndex } from "@/components/match/roster";
import { useLiveExtras } from "@/components/match/useLiveExtras";
import actionStyles from "@/components/match/MatchActions.module.css";
import { ApiError } from "@/lib/api";
import { mapName, modeLabel } from "@/lib/modes";
import type { MatchDetail, MatchPlayer, MatchStatus } from "@/lib/types";
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
// Server start up steps shown to players before the match goes live
const CONNECT_STEP: Partial<Record<MatchStatus, ConnectStep>> = { allocating: "allocating", starting: "starting", ready: "waiting" };
// Participants can report once the match is under way
const REPORTABLE: MatchStatus[] = ["live", "finished", "abandoned"];

export function MatchView({ id }: { id: string }) {
  const { match: base, error } = useMatch(id);
  const match = useLiveExtras(base);
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="container page">
        <header className="page-header">
          <h1>{notFound ? "Match not found" : "Could not load match"}</h1>
        </header>
        <Card>
          <p className="muted">{notFound ? "Check the link and try again." : "Try again in a moment."}</p>
          <p>
            <Link href="/play">Back to Play</Link>
          </p>
        </Card>
      </div>
    );
  }
  if (!match) return <MatchSkeleton />;
  return <MatchBody m={match} />;
}

function MatchBody({ m }: { m: MatchDetail }) {
  const { user } = useSession();
  const status = STATUS[m.status];
  const [a, b] = m.teams;
  const ownIndex = ownTeamIndex(m, user?.steamId);
  const sideOf = (i: number): TeamSide => (i === ownIndex ? "own" : "enemy");
  const roster = buildRoster(m, ownIndex);
  const finished = m.status === "finished";
  const connectStep = CONNECT_STEP[m.status];
  const topDamage = Math.max(0, ...m.teams.flatMap((t) => t.players.map((p) => p.damage)));
  return (
    <div className="container page">
      <header className={styles.header}>
        <div className="row">
          <Badge tone={status.tone}>
            {m.status === "live" && <Throbber />}
            {status.label}
          </Badge>
          {m.unrated && <Badge tone="info">Unrated</Badge>}
        </div>
        <h1 className={styles.title}>
          {modeLabel(m.mode)}
          {m.mapId && (
            <>
              {" "}
              <span className={styles.titleMap}>on {mapName(m.mode, m.mapId)}</span>
            </>
          )}
        </h1>
        {m.tournament && (
          <p className={styles.cup}>
            <Link href={`/tournaments/${m.tournament.id}`}>{m.tournament.name}</Link>
            <span className="muted">
              {" "}
              Game {m.tournament.gameNumber} of Bo{m.tournament.bestOf}
            </span>
          </p>
        )}
        <div className={actionStyles.actions}>
          {finished && (
            <>
              <RematchButton matchId={m.id} mode={m.mode} participants={m.teams.flatMap((t) => t.players.map((pl) => pl.steamId))} />
              <DemoActions matchId={m.id} demo={m.demo} />
            </>
          )}
          <ShareButton matchId={m.id} />
          {user && roster.has(user.steamId) && REPORTABLE.includes(m.status) && (
            <ReportButton matchId={m.id} roster={roster} viewer={user.steamId} serverReported={m.viewerReported} />
          )}
        </div>
      </header>

      {user && m.viewerReported && m.viewerReported.length > 0 && <MatchReportOutcomes matchId={m.id} reported={m.viewerReported} />}

      {finished && <MatchSummary m={m} roster={roster} ownIndex={ownIndex} viewer={user?.steamId} />}

      {((m.connect && CONNECTABLE.includes(m.status)) || (connectStep && user && roster.has(user.steamId))) && (
        <Card tone="accent" eyebrow="You are in this match" title="Connect">
          <div className="stack">
            {connectStep && <ConnectSteps step={connectStep} />}
            {m.connect && CONNECTABLE.includes(m.status) && (
              <div className="row">
                <a className={styles.connect} href={`steam://connect/${m.connect.ip}:${m.connect.port}/${encodeURIComponent(m.connect.password)}`}>
                  Launch CS2 and connect
                </a>
                <CopyButton text={m.connect.connect}>Copy connect</CopyButton>
                <code className={`mono muted ${styles.connectCode}`}>{m.connect.connect}</code>
              </div>
            )}
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

      {a && b && (
        <RoundTimeline
          rounds={m.rounds}
          teamA={a.name}
          teamB={b.name}
          sideA={sideOf(0)}
          rush={m.mode === "rush3v3"}
          kills={m.kills}
          roster={roster}
        />
      )}

      <div className={styles.tables}>
        {m.teams.map((t, i) => (
          <section key={t.name} aria-labelledby={`team-${i}`} className="stack">
            <h2 id={`team-${i}`} className={styles.teamHeading}>
              <TeamMarker side={sideOf(i)} />
              {t.displayName ?? t.name}
            </h2>
            <Table caption={`${t.displayName ?? t.name} players`} columns={playerColumns(sideOf(i), topDamage)} rows={t.players} rowKey={(p) => p.steamId} />
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
        {team.displayName ?? team.name}
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

const playerColumns = (side: TeamSide, topDamage: number): Column<MatchPlayer>[] => [
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
  { key: "dmg", header: "DMG", cell: (p) => <DamageBar damage={p.damage} top={topDamage} side={side} />, numeric: true },
];

// Bar length is relative to the highest damage in the match
function DamageBar({ damage, top, side }: { damage: number; top: number; side: TeamSide }) {
  const share = top > 0 ? Math.min(1, damage / top) : 0;
  return (
    <span className={styles.damage}>
      <span className={styles.damageTrack} data-side={side} aria-hidden="true">
        <span style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </span>
      <span>{Math.round(damage)}</span>
    </span>
  );
}
