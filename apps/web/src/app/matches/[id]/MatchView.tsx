"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { RUSH_ROOM_VETO, connectDeadlineOf, isRushMode, roomSlots, type MatchMap, type RoomStage, type RoomState } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { Table, type Column } from "@/components/ui/Table";
import { Throbber } from "@/components/ui/Throbber";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { TierChip } from "@/components/ui/TierChip";
import { MatchSkeleton } from "@/components/skeletons/MatchSkeleton";
import { DemoActions } from "@/components/match/DemoActions";
import { ResultHeader } from "@/components/match/ResultHeader";
import { MapThumb } from "@/components/play/MapThumb";
import { ReportButton } from "@/components/match/ReportDialog";
import { RoundTimeline } from "@/components/match/RoundTimeline";
import { MatchRushTrack, rushFlip, rushRoundPath } from "@/components/match/RushRoomTrack";
import { MatchReportOutcomes } from "@/components/review/MatchReportOutcomes";
import { ShareButton } from "@/components/match/ShareButton";
import { RematchButton } from "@/components/challenges/RematchButton";
import { buildRoster, ownTeamIndex } from "@/components/match/roster";
import { useLiveExtras } from "@/components/match/useLiveExtras";
import { AcceptPanel, AllocatingPanel, CancelledPanel, ConnectPanel, VetoPanel } from "@/components/match/room/StagePanels";
import { RoomResult } from "@/components/match/room/RoomResult";
import { RoomImage } from "@/components/rush/RoomImage";
import roomStyles from "@/components/match/room/Room.module.css";
import actionStyles from "@/components/match/MatchActions.module.css";
import { ApiError } from "@/lib/api";
import { signed } from "@/lib/format";
import { mapName, modeLabel } from "@/lib/modes";
import { useBackdrop } from "@/lib/useBackdrop";
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
  useBackdrop(detail?.mode);

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
  // Scores and stats once the server is up or rounds are in
  const scored = SCORED.includes(stage) || m.rounds.length > 0 || finished;

  return (
    <div className="container page">
      <header className={cx(styles.header, "title-band")}>
        {/* Status on the left, actions on the right, so they share a row on wide screens */}
        <div className={styles.headTop}>
          <div className="row">
            <Badge tone={status.tone}>
              {m.status === "live" && <Throbber />}
              {status.label}
            </Badge>
            {m.unrated && <Badge tone="info">Unrated</Badge>}
          </div>
          <div className={actionStyles.actions}>
            {finished && (
              <>
                <RematchButton matchId={m.id} mode={m.mode} participants={m.teams.flatMap((t) => t.players.map((pl) => pl.steamId))} />
                {!series && <DemoActions matchId={m.id} demo={m.demo} />}
              </>
            )}
            <ShareButton matchId={m.slug ?? m.id} />
            {participant && REPORTABLE.includes(m.status) && <ReportButton matchId={m.id} roster={roster} viewer={viewer!} serverReported={m.viewerReported} />}
          </div>
        </div>
        {/* An aim map's preview beside the title. Rush shows its rooms further down, a series has several maps */}
        <div className={styles.titleRow}>
          {currentMapId && !series && !isRushMode(m.mode) && <MapThumb mapId={currentMapId} className={styles.titleThumb} />}
          <div className={styles.titleText}>
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
          </div>
        </div>
        {scored && <ResultHeader m={m} roster={roster} ownIndex={ownIndex} viewer={viewer} sideOf={sideOf} />}
      </header>

      <StagePanel m={m} room={room} stage={stage} viewer={viewer} participant={participant} names={names} currentMapId={currentMapId} onRespond={onRespond} onVote={onVote} />

      {/* Before the match starts the Rush rooms stand on their own. Once it has a score they move into the
          flow card under the players. A series shows one per map in its map tab */}
      {isRushMode(m.mode) && stage !== "veto" && !series && !scored && (
        <MatchRushTrack m={m} rounds={m.rounds} sideOf={sideOf} picks={room.veto?.kind === "rooms" && room.veto.state.done ? roomSlots(room.veto.state, RUSH_ROOM_VETO.format) : null} />
      )}

      {viewer && m.viewerReported && m.viewerReported.length > 0 && <MatchReportOutcomes matchId={m.id} reported={m.viewerReported} />}

      {series ? (
        <SeriesView m={m} maps={maps} liveMap={liveMap?.mapNumber ?? null} sideOf={sideOf} roster={roster} before={<Lineup m={m} sideOf={sideOf} />} />
      ) : scored ? (
        <MapStats m={m} sideOf={sideOf} roster={roster} />
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
      return room.accept ? (
        <AcceptPanel
          accept={room.accept}
          mode={m.mode}
          participant={participant}
          onRespond={onRespond}
          viewer={viewer}
          team={(m.teams.find((t) => t.players.some((p) => p.steamId === viewer))?.players ?? []).map((p) => ({ steamId: p.steamId, name: p.displayName }))}
        />
      ) : null;
    case "veto":
      return <VetoPanel mode={m.mode} veto={participant ? room.veto : null} viewer={me} names={names} onVote={onVote} flip={isRushMode(m.mode) && rushFlip(m)} />;
    case "allocating":
      return participant ? <AllocatingPanel mode={m.mode} step={room.status === "starting" ? "starting" : "allocating"} veto={room.veto} viewer={me} /> : null;
    case "connect":
    case "live":
      return participant && room.server ? (
        <ConnectPanel
          mode={m.mode}
          server={room.server}
          live={stage === "live"}
          warmup={room.warmup}
          mapId={currentMapId}
          deadline={connectDeadlineOf(room)}
          names={names}
          viewer={viewer}
        />
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
  const rush = isRushMode(m.mode);
  const timeline = a && b && rounds.length > 0 && (
    <RoundTimeline
      rounds={rounds}
      teamA={a.name}
      teamB={b.name}
      sideA={sideOf(0)}
      rush={rush}
      kills={kills}
      roster={roster}
      rushPath={rush ? rushRoundPath(m, rounds, mapNumber, sideOf) : null}
    />
  );
  return (
    <>
      <PlayerTables m={m} sideOf={sideOf} topDamage={topDamage} />
      {/* Rush: the rooms and the rounds tell the same story, one by room and one by round, so they share a card */}
      {rush ? (
        <Card as="div" className={styles.flow}>
          <MatchRushTrack m={m} rounds={rounds} mapNumber={mapNumber} sideOf={sideOf} bare />
          {timeline}
        </Card>
      ) : (
        timeline
      )}
    </>
  );
}

// Series view. The map cards are the tabs, after a small one for the series totals. Upcoming maps show
// but cannot be picked yet. Before any map starts the panel holds what comes before, the lineup
function SeriesView({ m, maps, liveMap, sideOf, roster, before }: StatsProps & { maps: MatchMap[]; liveMap: number | null; before: ReactNode }) {
  const started = maps.filter((x) => x.status !== "upcoming");
  const [tab, setTab] = useState<string>(liveMap ? `map-${liveMap}` : "all");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Follow the live map as the series moves on
  useEffect(() => {
    if (liveMap) setTab(`map-${liveMap}`);
  }, [liveMap]);
  const selected = started.find((x) => `map-${x.mapNumber}` === tab);
  const current = selected ? `map-${selected.mapNumber}` : "all";
  const keys = ["all", ...started.map((x) => `map-${x.mapNumber}`)];
  const rush = isRushMode(m.mode);
  const [a, b] = m.teams;
  const view: MatchDetail = selected
    ? {
        ...m,
        mapId: selected.mapId,
        // Rating changes belong to the series, so they show on the totals only
        ratingDeltas: undefined,
        teams: m.teams.map((t) => ({
          ...t,
          score: selected.score[t.name] ?? 0,
          players: selected.players ? selected.players.filter((p) => t.players.some((x) => x.steamId === p.steamId)) : t.players,
        })),
      }
    : m;

  // Arrow keys move between the tabs that can be picked, as a tablist should
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = keys.indexOf(current);
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const key = keys[(to + keys.length) % keys.length]!;
    setTab(key);
    tabRefs.current[key]?.focus();
  };

  return (
    <section aria-labelledby="series-heading" className="stack">
      <h2 id="series-heading" className={styles.seriesTitle}>
        Best of {Math.max(m.bestOf ?? 1, maps.length)}
      </h2>
      <div role="tablist" aria-label="Series maps" className={styles.seriesTabs} style={{ "--maps": maps.length } as CSSProperties}>
        <button
          ref={(el) => {
            tabRefs.current.all = el;
          }}
          type="button"
          role="tab"
          id="series-tab-all"
          aria-selected={current === "all"}
          aria-controls="series-panel"
          tabIndex={current === "all" ? 0 : -1}
          className={cx("glass", styles.totalsTab)}
          onClick={() => setTab("all")}
          onKeyDown={onKey}
        >
          Series totals
        </button>
        {maps.map((x) => {
          const key = `map-${x.mapNumber}`;
          const upcoming = x.status === "upcoming";
          return (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`series-tab-${key}`}
              aria-selected={current === key}
              aria-controls="series-panel"
              aria-disabled={upcoming || undefined}
              tabIndex={current === key ? 0 : -1}
              className={cx("glass", styles.mapTab)}
              data-status={x.status}
              onClick={() => !upcoming && setTab(key)}
              onKeyDown={onKey}
            >
              {/* Each map has its own sides. Map 2 of a series room pick swaps them, so its row reverses */}
              <SeriesMapImage mode={m.mode} map={x} flip={rush && rushFlip(m, x)} />
              <span className={styles.mapTabBody}>
                <span className={styles.mapTabTop}>
                  <span className={styles.mapTabName}>
                    <span className="muted">Map {x.mapNumber} </span>
                    <span className="mono">{mapName(m.mode, x.mapId)}</span>
                  </span>
                  <Badge tone={x.status === "live" ? "win" : x.status === "done" ? "neutral" : "info"}>{SERIES_STATUS[x.status]}</Badge>
                </span>
                {!upcoming && a && b && (
                  <span className={styles.mapTabScore}>
                    <span data-side={sideOf(0)}>{x.score[a.name] ?? 0}</span>
                    <span aria-hidden="true"> : </span>
                    <span className="visually-hidden"> to </span>
                    <span data-side={sideOf(1)}>{x.score[b.name] ?? 0}</span>
                    {x.winnerTeam && <span className="visually-hidden">. Won by {x.winnerTeam === a.name ? (a.displayName ?? a.name) : (b.displayName ?? b.name)}</span>}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="series-panel" aria-labelledby={`series-tab-${current}`} className="stack">
        {started.length === 0 ? (
          before
        ) : selected ? (
          <>
            {selected.status === "done" && selected.demo && (
              <div className={actionStyles.actions}>
                <DemoActions matchId={m.id} demo={selected.demo} mapNumber={selected.mapNumber} label={`Map ${selected.mapNumber} demo`} />
              </div>
            )}
            <MapStats m={view} sideOf={sideOf} roster={roster} mapNumber={selected.mapNumber} />
          </>
        ) : (
          <>
            <p className="muted">Player stats add up every map played.</p>
            <MapStats m={{ ...m, rounds: [] }} sideOf={sideOf} roster={roster} />
          </>
        )}
      </div>
    </section>
  );
}

const SERIES_STATUS: Record<MatchMap["status"], string> = { upcoming: "Upcoming", live: "Live", done: "Done" };

// Aim maps show their preview. A Rush map shows the five rooms between the castles in a row, the start room
// largest in the middle and each step out smaller, in the page's left team first order. The castles are the
// same every match so they are left out. Outlines until the rooms are drawn
const RUSH_ROW_SIZE = [30, 25, 21];
// How far each room tucks under the one nearer the middle, in percent of the row
const RUSH_ROW_TUCK = [6, 5];

function SeriesMapImage({ mode, map, flip }: { mode: MatchDetail["mode"]; map: MatchMap; flip: boolean }) {
  if (!isRushMode(mode)) {
    return (
      <span className={styles.mapTabImage} aria-hidden="true">
        <MapThumb mapId={map.mapId} />
      </span>
    );
  }
  const slots = Array.from({ length: 5 }, (_, i) => map.rushRooms?.[i + 1]);
  const shown = flip ? [...slots].reverse() : slots;
  return (
    <span className={cx(styles.mapTabImage, styles.roomRow)} aria-hidden="true">
      {shown.map((room, i) => {
        const d = Math.abs(i - 2);
        // The room nearer the middle overlaps this one
        const tuck = i === 0 ? 0 : i <= 2 ? RUSH_ROW_TUCK[2 - i]! : RUSH_ROW_TUCK[i - 3]!;
        return (
          <span key={i} className={styles.roomRowItem} style={{ width: `${RUSH_ROW_SIZE[d]}%`, marginLeft: `-${tuck}%`, zIndex: 10 - d }}>
            {room !== undefined ? <RoomImage room={String(room)} /> : <span className={styles.roomRowBlank} />}
          </span>
        );
      })}
    </span>
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
          <Table caption={`${t.displayName ?? t.name} players`} columns={playerColumns(sideOf(i), topDamage, m.ratingDeltas)} rows={t.players} rowKey={(p) => p.steamId} />
        </section>
      ))}
    </div>
  );
}

const playerColumns = (side: TeamSide, topDamage: number, deltas?: Record<string, number>): Column<MatchPlayer>[] => [
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
  ...(deltas
    ? [
        {
          key: "rating",
          header: "Rating",
          cell: (p: MatchPlayer) => {
            const d = deltas[p.steamId];
            return (
              <span className={styles.delta} data-sign={d === undefined ? "none" : d >= 0 ? "up" : "down"}>
                {d === undefined ? "n/a" : signed(d)}
              </span>
            );
          },
          numeric: true,
        } satisfies Column<MatchPlayer>,
      ]
    : []),
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
