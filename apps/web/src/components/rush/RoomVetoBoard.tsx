"use client";

import { RUSH_ROOM_VETO, VETO_STEP_SEC, nextPickSlot, roomSlots, type RoomVetoFormat, type TeamIndex, type VetoState } from "@rushsite/shared";
import type { TeamSide } from "@/components/ui/TeamMarker";
import { Timer } from "@/components/ui/Timer";
import { cx } from "@/components/ui/cx";
import { useVetoTicks } from "@/components/play/useVetoTicks";
import { rushRoomName, rushSlotLabel } from "@/lib/rushRooms";
import { ComplexLayout } from "./ComplexLayout";
import { RoomImage } from "./RoomImage";
import styles from "./Rush.module.css";

type Props = {
  state: VetoState;
  // Empty for a viewer who is not playing
  mySteamId: string;
  stepDeadline: number | null;
  onVote?: (room: string) => void;
  names?: Record<string, string>;
  format?: RoomVetoFormat;
};

type CardInfo = { state: "available" | "banned" | "picked" | "start"; team?: TeamIndex; slot?: number; auto?: boolean };

// Rush room ban and pick. Every player on the acting team votes, the most votes win and ties are random
export function RoomVetoBoard({ state, mySteamId, stepDeadline, onVote, names = {}, format = RUSH_ROOM_VETO.format }: Props) {
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
  const pending = step ? state.teams[step.team].steamIds.filter((id) => !(id in state.votes)) : [];
  const lastAuto = state.history.at(-1)?.noVotes ? state.history.at(-1) : undefined;
  useVetoTicks(state.done ? null : stepDeadline, myTurn && !myVote);

  function info(room: string): CardInfo {
    const h = state.history.find((e) => e.mapId === room);
    if (h) return { state: h.action === "ban" ? "banned" : "picked", team: h.team, slot: slots.find((s) => s.room === room)?.slot, auto: h.noVotes };
    if (state.done) return { state: "start", slot: slots.find((s) => s.room === room)?.slot };
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
          ? `Pick a room for ${nextSlot !== null ? rushSlotLabel(nextSlot) : "your side"}.`
          : "Pick a room to ban."
      : myTeam === null
        ? "The teams are banning and picking rooms."
        : "Waiting for the opponents.";

  return (
    <section className={styles.board} aria-labelledby="room-veto-heading">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Room veto{step ? `, step ${state.stepIndex + 1} of ${state.steps.length}` : ""}</p>
          <h2 id="room-veto-heading" className={cx(styles.headline, myTurn && styles.myTurn)}>
            {headline}
          </h2>
          <p className={styles.sub} aria-live="polite">
            {sub}
          </p>
          {lastAuto && !state.done && (
            <p className={styles.sub} role="status">
              Time ran out. {rushRoomName(lastAuto.mapId)} was {lastAuto.action === "ban" ? "banned" : "picked"} at random.
            </p>
          )}
        </div>
        {!state.done && stepDeadline !== null && <Timer until={stepDeadline} totalSec={VETO_STEP_SEC} label={myTurn ? "Your turn" : "Their turn"} size="lg" />}
      </header>

      <ComplexLayout slots={slots} sideOf={sideOf} nextSlot={nextSlot} />

      <ol className={styles.steps} aria-label="Veto steps">
        {state.steps.map((s, i) => {
          const done = i < state.stepIndex || state.done;
          const current = i === state.stepIndex && !state.done;
          const h = state.history[i];
          return (
            <li key={i} className={cx(styles.step, done && styles.stepDone, current && styles.stepCurrent)} data-side={sideOf(s.team)} aria-current={current ? "step" : undefined}>
              <span className={styles.stepAction}>{s.action}</span>
              <span className={styles.stepTeam}>{myTeam === null ? state.teams[s.team].id : s.team === myTeam ? "You" : "Opp"}</span>
              {h && <span className="visually-hidden">{rushRoomName(h.mapId)}</span>}
            </li>
          );
        })}
      </ol>

      <ul className={styles.grid} role="list">
        {state.pool.map((room) => {
          const c = info(room);
          const selectable = myTurn && c.state === "available" && !!onVote;
          const votes = c.state === "available" ? counts.get(room) : undefined;
          const voted = myVote === room;
          const note =
            c.state === "banned"
              ? `Banned by ${teamName(c.team!).toLowerCase()}${c.auto ? ", timer" : ""}`
              : c.state === "picked"
                ? `Picked by ${teamName(c.team!).toLowerCase()}${c.slot !== undefined ? ` for ${rushSlotLabel(c.slot)}` : ""}`
                : c.state === "start"
                  ? "Last room left, plays as the start"
                  : voted
                    ? "Your vote"
                    : "";
          const body = (
            <>
              <RoomImage room={room} dim={c.state === "banned"} />
              <span className={styles.cardTop}>
                <span className={cx(styles.cardName, "mono")}>{rushRoomName(room)}</span>
                {votes !== undefined && votes > 0 && (
                  <span className={cx(styles.votes, "mono")}>
                    {votes}
                    <span className="visually-hidden"> {votes === 1 ? "vote" : "votes"}</span>
                  </span>
                )}
              </span>
              {note && <span className={styles.cardNote}>{note}</span>}
            </>
          );
          const cls = cx(styles.card, voted && styles.voted, selectable && styles.interactive);
          const side = c.team !== undefined ? sideOf(c.team) : undefined;
          return (
            <li key={room}>
              {selectable ? (
                <button
                  type="button"
                  className={cls}
                  data-state={c.state}
                  onClick={() => onVote?.(room)}
                  aria-pressed={voted}
                  aria-label={`${step!.action === "pick" ? "Pick" : "Ban"} ${rushRoomName(room)}${voted ? ", your vote" : ""}${votes ? `, ${votes} votes` : ""}`}
                >
                  {body}
                </button>
              ) : (
                <div className={cls} data-state={c.state} data-side={side}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {step && pending.length > 0 && (
        <p className={styles.sub}>Waiting on {pending.map((id) => (id === mySteamId ? "you" : (names[id] ?? "a player"))).join(", ")}</p>
      )}
    </section>
  );
}
