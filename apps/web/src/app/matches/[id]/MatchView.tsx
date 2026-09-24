"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { MatchMap, RoomStage, RoomState } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Table, type Column } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { Throbber } from "@/components/ui/Throbber";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { TierChip } from "@/components/ui/TierChip";
import { MatchSkeleton } from "@/components/skeletons/MatchSkeleton";
import { DemoActions } from "@/components/match/DemoActions";
import { MatchSummary } from "@/components/match/MatchSummary";
import { ReportButton } from "@/components/match/ReportDialog";
import { RoundTimeline } from "@/components/match/RoundTimeline";
import { MatchReportOutcomes } from "@/components/review/MatchReportOutcomes";
import { ShareButton } from "@/components/match/ShareButton";
import { RematchButton } from "@/components/challenges/RematchButton";
import { buildRoster, ownTeamIndex } from "@/components/match/roster";
import { useLiveExtras } from "@/components/match/useLiveExtras";
import { AcceptPanel, AllocatingPanel, CancelledPanel, ConnectPanel, VetoPanel } from "@/components/match/room/StagePanels";
import { RoomResult } from "@/components/match/room/RoomResult";
import { SeriesStrip } from "@/components/match/room/SeriesStrip";
import roomStyles from "@/components/match/room/Room.module.css";
import actionStyles from "@/components/match/MatchActions.module.css";
import { ApiError } from "@/lib/api";
import { mapName, modeLabel } from "@/lib/modes";
import type { MatchDetail, MatchPlayer, MatchStatus } from "@/lib/types";
import { useMatchRoom } from "@/lib/useMatchRoom";
import { useSession } from "@/lib/session";
import styles from "./match.module.css";

const STATUS: Record<MatchStatus, { label: string; tone: "win" | "neutral" | "loss" | "info" }> = {
  accepting: { label: "Accepting", tone: "info" },
  veto: { label: "Veto", tone: "info" },
  allocating: { label: "Starting", tone: "info" },
  starting: { label: "Starting", tone: "info" },
  ready: { label: "Connect", tone: "info" },
  live: { label: "Live", tone: "win" },
  finished: { label: "Finished", tone: "neutral" },
  abandoned: { label: "Abandoned", tone: "loss" },
  cancelled: { label: "Cancelled", tone: "loss" },
};

// Participants can report once the match is under way
const REPORTABLE: MatchStatus[] = ["live", "finished", "abandoned"];
// Scores and stats only mean something once the server is up
const SCORED: RoomStage[] = ["live", "result"];

export function MatchView({ id }: { id: string }) {
  const router = useRouter();
  const { detail, room, stage, error, respond, vote } = useMatchRoom(id);
  const match = useLiveExtras(detail);

  // Old uuid links move to the room id so the address bar shows the name
  const slug = detail?.slug;
  useEffect(() => {
    if (slug && detail && id === detail.id) router.replace(`/matches/${slug}`, { scroll: false });
  }, [slug, id]);

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
  if (!match || !room || !stage) return <MatchSkeleton />;
  return <MatchRoom m={match} room={room} stage={stage} onRespond={respond} onVote={vote} />;
}

type RoomProps = { m: MatchDetail; room: RoomState; stage: RoomStage; onRespond: (accept: boolean) => void; onVote: (mapId: string) => void };

function MatchRoom({ m: base, room, stage, onRespond, onVote }: RoomProps) {
  const { user } = useSession();
  const viewer = user?.steamId ?? null;
  // The socket is ahead of the last REST load for status and scores
  const m: MatchDetail = {
    ...base,
    status: room.status,
    teams: base.teams.map((t) => ({ ...t, score: room.scores.find((s) => s.name === t.name)?.score ?? t.score })),
  };
  const status = STATUS[m.status];
  const ownIndex = ownTeamIndex(m, viewer);
  const sideOf = (i: number): TeamSide => (i === ownIndex ? "own" : "enemy");
  const roster = buildRoster(m, ownIndex);
  const participant = !!viewer && roster.has(viewer);
  const finished = m.status === "finished";
  const maps = mergedMaps(base.maps, room.maps);
  const bestOf = m.bestOf ?? 1;
  const series = bestOf > 1 || maps.length > 1;
  const liveMap = maps.find((x) => x.mapNumber === room.liveMap) ?? maps.find((x) => x.status === "live");
  const currentMapId = liveMap?.mapId ?? m.mapId;
  const names = useMemo(() => Object.fromEntries(base.teams.flatMap((t) => t.players.map((p) => [p.steamId, p.displayName]))), [base.teams]);
  const [a, b] = m.teams;
  const teamInfo = a && b ? ([0, 1] as const).map((i) => ({ name: m.teams[i]!.name, label: m.teams[i]!.displayName ?? m.teams[i]!.name, side: sideOf(i) })) : null;
  const roomUrl = typeof window === "undefined" ? "" : `${window.location.origin}/matches/${m.slug ?? m.id}`;

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
          {currentMapId && !series && (
            <>
              {" "}
              <span className={styles.titleMap}>on {mapName(m.mode, currentMapId)}</span>
            </>
          )}
        </h1>
        {m.slug && (
          <p className={roomStyles.roomId}>
            <span>Room</span>
            <span className="mono">{m.slug}</span>
          </p>
        )}
        {m.tournament && (
          <p className={styles.cup}>
            <Link href={`/tournaments/${m.tournament.id}`}>{m.tournament.name}</Link>
            {!series && m.tournament.bestOf > 1 && (
              <span className="muted">
                {" "}
                Game {m.tournament.gameNumber} of Bo{m.tournament.bestOf}
              </span>
            )}
          </p>
        )}
        <div className={actionStyles.actions}>
          {finished && (
            <>
              <RematchButton matchId={m.id} mode={m.mode} participants={m.teams.flatMap((t) => t.players.map((pl) => pl.steamId))} />
              {!series && <DemoActions matchId={m.id} demo={m.demo} />}
            </>
          )}
          {roomUrl && <CopyButton text={roomUrl}>Copy room link</CopyButton>}
          <ShareButton matchId={m.slug ?? m.id} />
          {participant && REPORTABLE.includes(m.status) && <ReportButton matchId={m.id} roster={roster} viewer={viewer!} serverReported={m.viewerReported} />}
        </div>
      </header>

      <StagePanel m={m} room={room} stage={stage} viewer={viewer} participant={participant} names={names} currentMapId={currentMapId} onRespond={onRespond} onVote={onVote} />

      {viewer && m.viewerReported && m.viewerReported.length > 0 && <MatchReportOutcomes matchId={m.id} reported={m.viewerReported} />}

      {finished && <MatchSummary m={m} roster={roster} ownIndex={ownIndex} viewer={viewer} />}

      {series && teamInfo && (
        <SeriesStrip
          matchId={m.id}
          mode={m.mode}
          bestOf={Math.max(bestOf, maps.length)}
          maps={maps}
          teams={[teamInfo[0]!, teamInfo[1]!]}
          wins={Object.fromEntries(m.teams.map((t) => [t.name, t.score]))}
        />
      )}

      {SCORED.includes(stage) || m.rounds.length > 0 ? (
        series ? <SeriesStats m={m} maps={maps} liveMap={liveMap?.mapNumber ?? null} sideOf={sideOf} roster={roster} /> : <MapStats m={m} sideOf={sideOf} roster={roster} />
      ) : (
        <Lineup m={m} sideOf={sideOf} />
      )}
    </div>
  );
}

type StageProps = {
  m: MatchDetail;
  room: RoomState;
  stage: RoomStage;
  viewer: string | null;
  participant: boolean;
  names: Record<string, string>;
  currentMapId: string | null;
  onRespond: (accept: boolean) => void;
  onVote: (mapId: string) => void;
};

function StagePanel({ m, room, stage, viewer, participant, names, currentMapId, onRespond, onVote }: StageProps) {
  const me = participant ? viewer : null;
  switch (stage) {
    case "accept":
      return room.accept ? <AcceptPanel accept={room.accept} mode={m.mode} participant={participant} onRespond={onRespond} /> : null;
    case "veto":
      return <VetoPanel mode={m.mode} veto={participant ? room.veto : null} viewer={me} names={names} onVote={onVote} />;
    case "allocating":
      return participant ? <AllocatingPanel mode={m.mode} step={room.status === "starting" ? "starting" : "allocating"} veto={room.veto} viewer={me} /> : null;
    case "connect":
    case "live":
      return participant && room.server ? (
        <ConnectPanel mode={m.mode} server={room.server} live={stage === "live"} warmup={room.warmup} mapId={currentMapId} />
      ) : null;
    case "result":
      return <RoomResult m={m} result={room.result} viewer={viewer} />;
    case "cancelled":
      return <CancelledPanel reason={room.cancelReason} participant={participant} />;
  }
}

// REST maps carry players and demos, the socket carries the newest status and score
function mergedMaps(rest: MatchMap[] | undefined, live: RoomState["maps"]): MatchMap[] {
  if (live.length === 0) return rest ?? [];
  return live.map((x) => {
    const r = rest?.find((y) => y.mapNumber === x.mapNumber);
    return { ...r, ...x, ...(r?.players ? { players: r.players } : {}), ...(x.demo ?? r?.demo ? { demo: x.demo ?? r?.demo } : {}) };
  });
}

type StatsProps = { m: MatchDetail; sideOf: (i: number) => TeamSide; roster: ReturnType<typeof buildRoster> };

// Before the server is up there are no stats, only who plays
function Lineup({ m, sideOf }: Pick<StatsProps, "m" | "sideOf">) {
  return (
    <div className={styles.tables}>
      {m.teams.map((t, i) => (
        <section key={t.name} aria-labelledby={`team-${i}`} className="stack">
          <h2 id={`team-${i}`} className={styles.teamHeading}>
            <TeamMarker side={sideOf(i)} />
            {t.displayName ?? t.name}
          </h2>
          <ul className={styles.lineup}>
            {t.players.map((p) => (
              <li key={p.steamId} className="row">
                <Avatar name={p.displayName} src={p.avatarUrl} size="sm" />
                <Link href={`/profile/${p.steamId}`} className={styles.playerName}>
                  {p.displayName}
                </Link>
                <TierChip tier={p.tier} rating={p.rating} size="sm" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MapStats({ m, sideOf, roster, mapNumber }: StatsProps & { mapNumber?: number }) {
  const [a, b] = m.teams;
  const rounds = mapNumber === undefined ? m.rounds : m.rounds.filter((r) => (r.mapNumber ?? 1) === mapNumber);
  const kills = mapNumber === undefined ? m.kills : m.kills?.filter((k) => (k.mapNumber ?? 1) === mapNumber);
  const topDamage = Math.max(0, ...m.teams.flatMap((t) => t.players.map((p) => p.damage)));
  return (
    <>
      {a && b && (
        <section className={styles.scoreboard} aria-label="Score">
          <TeamScore team={a} side={sideOf(0)} />
          <span className={styles.dash} aria-hidden="true">
            :
          </span>
          <TeamScore team={b} side={sideOf(1)} />
        </section>
      )}
      {a && b && rounds.length > 0 && (
        <RoundTimeline rounds={rounds} teamA={a.name} teamB={b.name} sideA={sideOf(0)} rush={m.mode === "rush3v3"} kills={kills} roster={roster} />
      )}
      <PlayerTables m={m} sideOf={sideOf} topDamage={topDamage} />
    </>
  );
}

// Series view. One tab for totals and one per map that has started
function SeriesStats({ m, maps, liveMap, sideOf, roster }: StatsProps & { maps: MatchMap[]; liveMap: number | null }) {
  const started = maps.filter((x) => x.status !== "upcoming");
  const [tab, setTab] = useState<string>(liveMap ? `map-${liveMap}` : "all");
  // Follow the live map as the series moves on
  useEffect(() => {
    if (liveMap) setTab(`map-${liveMap}`);
  }, [liveMap]);
  const selected = started.find((x) => `map-${x.mapNumber}` === tab);
  const items = [{ key: "all", label: "Series totals" }, ...started.map((x) => ({ key: `map-${x.mapNumber}`, label: `Map ${x.mapNumber} · ${mapName(m.mode, x.mapId)}` }))];
  const view: MatchDetail = selected
    ? {
        ...m,
        mapId: selected.mapId,
        teams: m.teams.map((t) => ({
          ...t,
          score: selected.score[t.name] ?? 0,
          players: selected.players ? selected.players.filter((p) => t.players.some((x) => x.steamId === p.steamId)) : t.players,
        })),
      }
    : m;
  return (
    <Tabs label="Series stats" items={items} value={selected ? tab : "all"} onChange={setTab} idPrefix="series">
      <div className="stack">
        {selected ? (
          <MapStats m={view} sideOf={sideOf} roster={roster} mapNumber={selected.mapNumber} />
        ) : (
          <>
            <p className="muted">Maps won in the big score. Player stats add up every map played.</p>
            <MapStats m={{ ...m, rounds: [] }} sideOf={sideOf} roster={roster} />
          </>
        )}
      </div>
    </Tabs>
  );
}

function PlayerTables({ m, sideOf, topDamage }: { m: MatchDetail; sideOf: (i: number) => TeamSide; topDamage: number }) {
  return (
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
