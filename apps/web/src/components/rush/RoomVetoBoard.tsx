"use client";

import { RUSH_ROOM_VETO, VETO_STEP_SEC, currentRoomPhase, nextPickSlot, roomSlots, type RoomVetoFormat, type TeamIndex, type VetoState } from "@rushsite/shared";
import type { TeamSide } from "@/components/ui/TeamMarker";
import { cx } from "@/components/ui/cx";
import { VetoSteps } from "@/components/ui/VetoSteps";
import { VetoHead } from "@/components/ui/VetoHead";
import { nextIsMine, turnClass, vetoTurn, waitingOn } from "@/components/ui/VetoTurn";
import { MapCard, type MapCardVoter } from "@/components/ui/MapCard";
import { useVetoTicks } from "@/components/play/useVetoTicks";
import { rushRoomImage, rushRoomName, rushSlotLabel } from "@/lib/rushRooms";
import { ComplexLayout } from "./ComplexLayout";
import { usePreviewRoom } from "./usePreviewRoom";
import styles from "./Rush.module.css";

type Props = {
  state: VetoState;
  // Empty for a viewer who is not playing
  mySteamId: string;
  stepDeadline: number | null;
  onVote?: (room: string) => void;
  names?: Record<string, string>;
  format?: RoomVetoFormat;
  // Left team defends the CT castle, see ComplexLayout
  flip?: boolean;
};

type CardInfo = { state: "available" | "banned" | "picked" | "start"; team?: TeamIndex; slot?: number; auto?: boolean };

// Rush room ban and pick. Every player on the acting team votes, the most votes win and ties are random
export function RoomVetoBoard({ state, mySteamId, stepDeadline, onVote, names = {}, format = RUSH_ROOM_VETO.format, flip }: Props) {
  const inA = state.teams[0].steamIds.includes(mySteamId);
  const inB = state.teams[1].steamIds.includes(mySteamId);
  const myTeam: TeamIndex | null = inA ? 0 : inB ? 1 : null;
  // A neutral viewer sees the first team in the own colour
  const sideOf = (t: TeamIndex): TeamSide => (t === (myTeam ?? 0) ? "own" : "enemy");
  const teamName = (t: TeamIndex) => (myTeam === null ? `Team ${state.teams[t].id}` : t === myTeam ? "Your team" : "Opponents");

  const step = state.done ? null : (state.steps[state.stepIndex] ?? null);
  const myTurn = !!step && step.team === myTeam;
  const myVote = state.votes[mySteamId];
  const slots = roomSlots(state, format);
  const nextSlot = nextPickSlot(state, format);
  const counts = new Map<string, number>();
  Object.values(state.votes).forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1));
  const actingTeam = step ? state.teams[step.team] : null;
  const turn = vetoTurn(state, myTeam, mySteamId);
  const next = nextIsMine(state, myTeam);
  const waiting = turn === "voted" ? waitingOn(state, mySteamId, names) : null;
  const lastAuto = state.history.at(-1)?.noVotes ? state.history.at(-1) : undefined;
  const running = currentRoomPhase(state, format);
  const phaseIdx = running?.index ?? null;
  // Steps and rooms of the running phase only. Earlier phases live in the layout
  const phaseSteps = state.steps.map((s, i) => ({ s, i })).filter(({ s }) => (s.phase ?? 0) === phaseIdx);
  const phasePool = running ? state.pool.filter((r) => running.phase.pool.includes(r)) : [];
  const { previewRoom, previewOf } = usePreviewRoom(state.stepIndex);
  useVetoTicks(state.done ? null : stepDeadline, myTurn && !myVote);

  // Acting team members who voted for this room, in team order
  function votersFor(room: string): MapCardVoter[] {
    if (!actingTeam) return [];
    return actingTeam.steamIds
      .filter((id) => state.votes[id] === room)
      .map((id) => ({ steamId: id, name: id === mySteamId ? "You" : (names[id] ?? "Player"), me: id === mySteamId }));
  }

  function info(room: string): CardInfo {
    const h = state.history.find((e) => e.mapId === room);
    if (h) return { state: h.action === "ban" ? "banned" : "picked", team: h.team, slot: slots.find((s) => s.room === room)?.slot, auto: h.noVotes };
    const slot = slots.find((s) => s.room === room);
    if (slot?.source === "leftover") return { state: "start", slot: slot.slot };
    return { state: "available" };
  }

  const verb = step?.action === "pick" ? "pick" : "ban";
  const headline = state.done ? "Rooms locked in" : `${teamName(step!.team)} ${myTeam !== null && step!.team !== myTeam ? verb : `${verb}s`}`;
  const sub = state.done
    ? "Starting server."
    : myTurn
      ? myVote
        ? `You voted ${rushRoomName(myVote)}. Change it until everyone on your team has voted.`
        : step!.action === "pick"
          ? `Pick a room to play in ${nextSlot !== null ? rushSlotLabel(nextSlot) : "your side"}.`
          : "Pick a room to ban."
      : myTeam === null
        ? "The teams are banning and picking rooms."
        : "Waiting for the opponents.";

  return (
    <section className={styles.board} aria-labelledby="room-veto-heading">
      <VetoHead
        id="room-veto-heading"
        eyebrow={`Room veto${running ? `, ${running.phase.label.toLowerCase()}, step ${phaseSteps.findIndex(({ i }) => i === state.stepIndex) + 1} of ${phaseSteps.length}` : ""}`}
        turn={turn}
        next={next}
        headline={headline}
        sub={sub}
        notes={
          lastAuto && !state.done ? (
            <p className={styles.sub} role="status">
              Time ran out. {rushRoomName(lastAuto.mapId)} was {lastAuto.action === "ban" ? "banned" : "picked"} at random.
            </p>
          ) : null
        }
        stepDeadline={stepDeadline}
        totalSec={VETO_STEP_SEC}
      />

      <ol className={styles.phases} aria-label="Veto phases">
        {format.phases.map((p, idx) => {
          const current = idx === phaseIdx;
          const done = state.done || (phaseIdx !== null && idx < phaseIdx);
          return (
            <li key={p.id} className={cx(styles.phase, current && styles.phaseCurrent, done && styles.phaseDone)} aria-current={current ? "step" : undefined}>
              <span className="mono">{idx + 1}</span> {p.label}
              {done && <span className="visually-hidden">, done</span>}
            </li>
          );
        })}
      </ol>

      <ComplexLayout slots={slots} sideOf={sideOf} nextSlot={nextSlot} previewRoom={previewRoom ?? (step?.action === "pick" ? (myVote ?? null) : null)} flip={flip} ctTeam={flip ? 0 : 1} />


      {phasePool.length > 0 && (
      <ul className={cx(styles.grid, turnClass.grid)} data-turn={turn} role="list">
        {phasePool.map((room) => {
          const c = info(room);
          const selectable = myTurn && c.state === "available" && !!onVote;
          const by = c.team !== undefined ? { label: teamName(c.team).toLowerCase(), side: sideOf(c.team) } : undefined;
          return (
            <li key={room}>
              <MapCard
                mapId={room}
                name={rushRoomName(room)}
                imageSrc={rushRoomImage(room)}
                state={c.state === "start" ? "decider" : c.state}
                stampLabel={c.state === "start" ? "Start room" : undefined}
                by={by}
                tag={c.auto ? "auto" : undefined}
                voted={myVote === room}
                votes={c.state === "available" ? counts.get(room) : undefined}
                voters={c.state === "available" && actingTeam ? votersFor(room) : undefined}
                voterTotal={actingTeam?.steamIds.length}
                voterSide={step && step.team === myTeam ? "own" : "enemy"}
                onSelect={selectable ? () => onVote?.(room) : undefined}
                onPreview={selectable ? previewOf(room) : undefined}
                actionLabel={step?.action === "pick" ? "Pick" : "Ban"}
              />
            </li>
          );
        })}
      </ul>
      )}


      <VetoSteps
        label="Veto steps"
        steps={phaseSteps.map(({ s, i }) => ({
          action: s.action,
          team: myTeam === null ? `Team ${state.teams[s.team].id}` : s.team === myTeam ? "You" : "Opponents",
          owner: sideOf(s.team),
          status: state.done || i < state.stepIndex ? "done" : i === state.stepIndex ? "current" : "upcoming",
          result: state.history[i] ? rushRoomName(state.history[i]!.mapId) : undefined,
        }))}
      />
    </section>
  );
}
