"use client";

import {
  RUSH_SERIES_ROOM_VETO,
  VETO_STEP_SEC,
  currentSeriesRoomStep,
  seriesNextPickSlot,
  seriesRoomMaps,
  sideKey,
  sideOfKey,
  type SeriesRoomStepKind,
  type SeriesRoomVetoFormat,
  type TeamIndex,
  type VetoState,
} from "@rushsite/shared";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { Timer } from "@/components/ui/Timer";
import { cx } from "@/components/ui/cx";
import { VetoTurnChip, nextIsMine, turnClass, vetoTurn, waitingOn } from "@/components/ui/VetoTurn";
import { MapCard, type MapCardVoter } from "@/components/ui/MapCard";
import { useVetoTicks } from "@/components/play/useVetoTicks";
import { rushRoomImage, rushRoomName, rushSlotLabel } from "@/lib/rushRooms";
import { ComplexLayout } from "./ComplexLayout";
import { usePreviewRoom } from "./usePreviewRoom";
import styles from "./Rush.module.css";
import own from "./SeriesRoomVeto.module.css";

type Props = {
  state: VetoState;
  // Empty for a viewer who is not playing
  mySteamId: string;
  stepDeadline: number | null;
  onVote?: (key: string) => void;
  names?: Record<string, string>;
  format?: SeriesRoomVetoFormat;
};

type Play = "ct" | "t";

const other = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0);
const PLAY_LABEL: Record<Play, string> = { ct: "CT", t: "T" };
const PLAY_NOTE: Record<Play, string> = { ct: "Holds the CT castle", t: "Holds the T castle" };
// Mid rooms on one map. A map that picks fewer takes the mid rooms no map used
const MID_SLOTS = 4;
const STEP_LABEL: Record<SeriesRoomStepKind, string> = { side: "side", mid: "mid", start: "start" };

// A vote key as words: a room name, or a side
function keyLabel(key: string): string {
  const play = key.startsWith("side:") ? sideOfKey(key) : null;
  return play ? PLAY_LABEL[play] : rushRoomName(key);
}

// Rush room pick for a whole Bo3, run once before map 1. Sides, mid rooms and the start room map by map,
// no bans and no room twice. Every player on the acting team votes, the most votes win and ties are random
export function SeriesRoomVetoBoard({ state, mySteamId, stepDeadline, onVote, names = {}, format = RUSH_SERIES_ROOM_VETO.format }: Props) {
  const inA = state.teams[0].steamIds.includes(mySteamId);
  const inB = state.teams[1].steamIds.includes(mySteamId);
  const myTeam: TeamIndex | null = inA ? 0 : inB ? 1 : null;
  // A neutral viewer sees the first team in the own colour
  const sideOf = (t: TeamIndex): TeamSide => (t === (myTeam ?? 0) ? "own" : "enemy");
  const teamName = (t: TeamIndex) => (myTeam === null ? `Team ${state.teams[t].id}` : t === myTeam ? "Your team" : "Opponents");
  // "Opponents pick", "Your team picks"
  const verb = (t: TeamIndex, base: string) => (myTeam !== null && t !== myTeam ? base : `${base}s`);

  const step = state.done ? null : (state.steps[state.stepIndex] ?? null);
  const cur = currentSeriesRoomStep(state);
  const myTurn = !!step && step.team === myTeam;
  const myVote = state.votes[mySteamId];
  const maps = seriesRoomMaps(state, format);
  const nextSlot = seriesNextPickSlot(state, format);
  const phases = state.phases ?? [];
  const phaseAt = (i: number) => phases[state.steps[i]?.phase ?? -1];
  const actingTeam = step ? state.teams[step.team] : null;
  const turn = vetoTurn(state, myTeam, mySteamId);
  const next = nextIsMine(state, myTeam);
  const waiting = turn === "voted" ? waitingOn(state, mySteamId, names) : null;
  const lastAuto = state.history.at(-1)?.noVotes ? state.history.at(-1) : undefined;
  const counts = new Map<string, number>();
  Object.values(state.votes).forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1));
  // Steps of the map being decided. The map tracks carry the rest
  const mapSteps = cur ? state.steps.map((s, i) => ({ s, i })).filter(({ i }) => phaseAt(i)?.mapNumber === cur.mapNumber) : [];
  const pool = cur && cur.kind !== "side" && step?.phase !== undefined ? (phases[step.phase]?.pool ?? []) : [];
  const lastMap = format.maps;
  const { previewRoom, previewOf } = usePreviewRoom(state.stepIndex);
  useVetoTicks(state.done ? null : stepDeadline, myTurn && !myVote);

  // Acting team members who voted for this key, in team order
  function votersFor(key: string): MapCardVoter[] {
    if (!actingTeam) return [];
    return actingTeam.steamIds
      .filter((id) => state.votes[id] === key)
      .map((id) => ({ steamId: id, name: id === mySteamId ? "You" : (names[id] ?? "Player"), me: id === mySteamId }));
  }

  const headline = (() => {
    if (!cur) return "Rooms locked in";
    const who = teamName(cur.team);
    if (cur.kind === "side") return `${who} ${verb(cur.team, "choose")} a side for map ${cur.mapNumber}`;
    return `${who} ${verb(cur.team, "pick")} ${cur.kind === "mid" ? "a mid room" : "the start room"} for map ${cur.mapNumber}`;
  })();

  const sub = (() => {
    if (!cur) return "Starting server.";
    if (myTurn && myVote) return `You voted ${keyLabel(myVote)}. Change it until everyone on your team has voted.`;
    if (!myTurn) return myTeam === null ? "The teams are picking rooms for the series." : "Waiting for the opponents.";
    if (cur.kind === "side") return cur.mapNumber === 1 ? "Choose the side your team plays. Sides swap for map 2." : `Choose the side your team plays on map ${cur.mapNumber}.`;
    if (cur.kind === "start") return `Pick the room in the middle of map ${cur.mapNumber}.`;
    return `Pick a room for ${nextSlot !== null ? rushSlotLabel(nextSlot) : "your side"}, beside your own castle.`;
  })();

  // Map 3: team B picks two mid rooms and team A gets the ones left
  const leftover = cur?.kind === "mid" ? MID_SLOTS - format.steps.filter((s) => s.map === cur.mapNumber && s.kind === "mid").length : 0;
  const leftoverNote = cur && leftover > 0 ? `The ${leftover} rooms left go to ${teamName(other(cur.team)).toLowerCase()}.` : null;

  const flipWinner = state.flipWinner;
  const flipNote =
    flipWinner === undefined ? null : `Coin flip: ${teamName(flipWinner)} ${myTeam !== null && flipWinner !== myTeam ? "are" : "is"} team A on map ${lastMap}.`;

  return (
    <section className={styles.board} aria-labelledby="series-room-veto-heading">
      <header className={cx(styles.header, !state.done && turnClass.band)} data-turn={turn}>
        <div>
          <p className="eyebrow">
            Room pick{cur ? `, map ${cur.mapNumber}, step ${mapSteps.findIndex(({ i }) => i === state.stepIndex) + 1} of ${mapSteps.length}` : ""}
          </p>
          <VetoTurnChip turn={turn} next={next} />
          <h2 id="series-room-veto-heading" className={cx(styles.headline, myTurn && styles.myTurn)}>
            {headline}
          </h2>
          <p className={styles.sub} aria-live="polite">
            {sub}
            {leftoverNote && ` ${leftoverNote}`}
          </p>
          {lastAuto && !state.done && (
            <p className={styles.sub} role="status">
              Time ran out. {keyLabel(lastAuto.mapId)} was {lastAuto.action === "side" ? "chosen" : "picked"} at random.
            </p>
          )}
          {flipNote && <p className={own.flip}>{flipNote}</p>}
        </div>
        {!state.done && stepDeadline !== null && <Timer until={stepDeadline} totalSec={VETO_STEP_SEC} label={myTurn ? "Your turn" : "Their turn"} size="lg" />}
      </header>

      <ol className={own.maps} aria-label="Maps">
        {maps.map((mp) => {
          const current = cur?.mapNumber === mp.mapNumber;
          const done = state.done || (!!cur && mp.mapNumber < cur.mapNumber);
          // The left team is team 0. It plays CT when the CT castle is drawn on the left, as on the match page
          const flip = mp.ctTeam === 0;
          const playOf = (t: TeamIndex): Play | null => (mp.ctTeam === null ? null : mp.ctTeam === t ? "ct" : "t");
          return (
            <li key={mp.mapNumber} className={cx(own.map, current && own.mapCurrent, done && own.mapDone)} aria-current={current ? "step" : undefined}>
              <div className={own.mapHead}>
                {([0, 1] as const).map((t) => {
                  const play = playOf(t);
                  return (
                    <span key={t} className={own.mapTeam} data-side={sideOf(t)} data-end={t === 0 ? "left" : "right"}>
                      <TeamMarker side={sideOf(t)} />
                      <span className={own.mapTeamName}>{teamName(t)}</span>
                      <span className={cx(own.play, "mono")} data-open={play === null || undefined}>
                        {play ? (
                          PLAY_LABEL[play]
                        ) : (
                          <>
                            <span aria-hidden="true">?</span>
                            <span className="visually-hidden">side not chosen yet</span>
                          </>
                        )}
                      </span>
                    </span>
                  );
                })}
                <span className={own.mapName}>
                  Map {mp.mapNumber}
                  {done && <span className="visually-hidden">, done</span>}
                </span>
              </div>
              <ComplexLayout slots={mp.slots} sideOf={sideOf} nextSlot={current ? nextSlot : null} previewRoom={current ? previewRoom : null} flip={flip} compact />
            </li>
          );
        })}
      </ol>

      {mapSteps.length > 0 && (
        <ol className={styles.steps} aria-label={`Steps for map ${cur?.mapNumber}`}>
          {mapSteps.map(({ s, i }) => {
            const doneStep = i < state.stepIndex;
            const currentStep = i === state.stepIndex;
            const h = state.history[i];
            const kind = phaseAt(i)?.kind ?? "mid";
            return (
              <li key={i} className={cx(styles.step, turnClass.step, doneStep && styles.stepDone, currentStep && styles.stepCurrent)} data-side={sideOf(s.team)} data-owner={sideOf(s.team)} aria-current={currentStep ? "step" : undefined}>
                <span className={styles.stepAction}>{STEP_LABEL[kind]}</span>
                <span className={styles.stepTeam}>{myTeam === null ? state.teams[s.team].id : s.team === myTeam ? "You" : "Opp"}</span>
                {h && <span className="visually-hidden">{keyLabel(h.mapId)}</span>}
              </li>
            );
          })}
        </ol>
      )}

      {cur?.kind === "side" && (
        <div className={cx(own.sides, turnClass.grid)} data-turn={turn} role="group" aria-label={`Side for map ${cur.mapNumber}`}>
          {(["ct", "t"] as const).map((play) => {
            const key = sideKey(cur.mapNumber, play);
            const voters = votersFor(key);
            const voted = myVote === key;
            const selectable = myTurn && !!onVote;
            const others = voters.filter((v) => !v.me).map((v) => v.name);
            const label = [`Play ${PLAY_LABEL[play]}`, voted ? "your vote" : null, others.length ? `voted by ${others.join(", ")}` : null].filter(Boolean).join(", ");
            return (
              <button
                key={play}
                type="button"
                className={cx("glass", own.side, selectable && own.sideActive, voted && own.sideVoted)}
                data-play={play}
                onClick={selectable ? () => onVote?.(key) : undefined}
                disabled={!selectable}
                aria-pressed={voted}
                aria-label={label}
              >
                <span className={own.sideName}>{PLAY_LABEL[play]}</span>
                <span className={own.sideNote}>{PLAY_NOTE[play]}</span>
                {voters.length > 0 && (
                  <span className={own.voteRow} aria-hidden="true">
                    {voters.map((v) => (
                      <span key={v.steamId} className={cx(own.dot, step?.team === myTeam ? own.dotOwn : own.dotEnemy, v.me && own.dotMe)} title={v.me ? "Your vote" : v.name}>
                        {(v.name.trim()[0] ?? "?").toUpperCase()}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {pool.length > 0 && (
        <ul className={cx(styles.grid, own.grid, turnClass.grid)} data-turn={turn} role="list">
          {pool.map((room) => {
            const h = state.history.find((e) => e.mapId === room);
            const onMap = h ? phaseAt(h.step)?.mapNumber : undefined;
            const slot = onMap !== undefined ? maps[onMap - 1]?.slots.find((x) => x.room === room)?.slot : undefined;
            const thisMap = !!h && onMap === cur?.mapNumber;
            const available = !h;
            const selectable = myTurn && available && !!onVote;
            const by = h ? { label: teamName(h.team).toLowerCase(), side: sideOf(h.team) } : undefined;
            return (
              <li key={room}>
                <MapCard
                  mapId={room}
                  name={rushRoomName(room)}
                  imageSrc={rushRoomImage(room)}
                  state={available ? "available" : thisMap ? "picked" : "taken"}
                  stampLabel={!available && !thisMap ? `Map ${onMap}` : undefined}
                  by={by}
                  note={thisMap && slot !== undefined ? `For ${rushSlotLabel(slot)}` : undefined}
                  tag={h?.noVotes ? "auto" : undefined}
                  voted={myVote === room}
                  votes={available ? counts.get(room) : undefined}
                  voters={available && actingTeam ? votersFor(room) : undefined}
                  voterTotal={actingTeam?.steamIds.length}
                  voterSide={step && step.team === myTeam ? "own" : "enemy"}
                  onSelect={selectable ? () => onVote?.(room) : undefined}
                  onPreview={selectable ? previewOf(room) : undefined}
                  actionLabel="Pick"
                />
              </li>
            );
          })}
        </ul>
      )}

    </section>
  );
}
