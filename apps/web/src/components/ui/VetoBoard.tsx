"use client";

import type { Mode, VetoState } from "@rushsite/shared";
import { mapName } from "@/lib/modes";
import { MapCard, type MapCardState } from "./MapCard";
import { Timer } from "./Timer";
import { cx } from "./cx";
import styles from "./VetoBoard.module.css";

type VetoBoardProps = {
  mode: Mode;
  state: VetoState;
  mySteamId: string;
  // Epoch ms when the current step resolves
  stepDeadline: number | null;
  onVote?: (mapId: string) => void;
  // Display names by steamId for vote lists
  names?: Record<string, string>;
  // Freezes the timer for static previews
  frozenSec?: number;
};

export function VetoBoard({ mode, state, mySteamId, stepDeadline, onVote, names = {}, frozenSec }: VetoBoardProps) {
  const myTeam = state.teams[0].steamIds.includes(mySteamId) ? 0 : 1;
  const step = state.done ? null : state.steps[state.stepIndex] ?? null;
  const myTurn = step?.team === myTeam;
  const myVote = state.votes[mySteamId];
  const voteCounts = new Map<string, number>();
  Object.values(state.votes).forEach((m) => voteCounts.set(m, (voteCounts.get(m) ?? 0) + 1));
  const actingTeam = step ? state.teams[step.team] : null;
  const pending = actingTeam ? actingTeam.steamIds.filter((id) => !(id in state.votes)) : [];

  function cardState(mapId: string): { state: MapCardState; note?: string } {
    const h = state.history.find((e) => e.mapId === mapId);
    if (h) {
      const who = h.team === myTeam ? "your team" : "opponents";
      return { state: h.action === "ban" ? "banned" : "picked", note: `By ${who}` };
    }
    if (state.done && state.maps.includes(mapId)) return { state: "decider" };
    return { state: "available" };
  }

  const headline = state.done
    ? `Map: ${state.maps.map((m) => mapName(mode, m)).join(", ")}`
    : myTurn
      ? `Your team ${step!.action}s`
      : `Opponents ${step!.action}`;

  const sub = state.done
    ? "Starting server."
    : myTurn
      ? myVote
        ? `You voted ${mapName(mode, myVote)}.`
        : "Pick a map to ban."
      : "Waiting for opponents.";

  return (
    <section className={styles.board} aria-labelledby="veto-heading">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">
            Map veto{step ? `, step ${state.stepIndex + 1} of ${state.steps.length}` : ""}
          </p>
          <h2 id="veto-heading" className={cx(styles.headline, myTurn && styles.myTurn)}>
            {headline}
          </h2>
          <p className={styles.sub} aria-live="polite">
            {sub}
          </p>
        </div>
        {!state.done && stepDeadline !== null && (
          <Timer until={stepDeadline} frozenSec={frozenSec} label="Step" size="sm" />
        )}
      </header>

      <ol className={styles.steps} aria-label="Veto steps">
        {state.steps.map((s, i) => {
          const done = i < state.stepIndex || state.done;
          const current = i === state.stepIndex && !state.done;
          const h = state.history[i];
          return (
            <li
              key={i}
              className={cx(styles.step, done && styles.stepDone, current && styles.stepCurrent, s.team === myTeam ? styles.stepUs : styles.stepThem)}
              aria-current={current ? "step" : undefined}
            >
              <span className={styles.stepAction}>{s.action}</span>
              <span className={styles.stepTeam}>{s.team === myTeam ? "You" : "Opp"}</span>
              {h && <span className="visually-hidden">{mapName(mode, h.mapId)}</span>}
            </li>
          );
        })}
      </ol>

      <ul className={styles.grid} role="list">
        {state.pool.map((mapId) => {
          const cs = cardState(mapId);
          const selectable = myTurn && cs.state === "available" && !!onVote;
          return (
            <li key={mapId}>
              <MapCard
                mapId={mapId}
                name={mapName(mode, mapId)}
                state={cs.state}
                note={cs.note}
                voted={myVote === mapId}
                votes={cs.state === "available" ? voteCounts.get(mapId) : undefined}
                onSelect={selectable ? () => onVote?.(mapId) : undefined}
                actionLabel={step?.action === "pick" ? "Pick" : "Ban"}
              />
            </li>
          );
        })}
      </ul>

      {actingTeam && pending.length > 0 && (
        <p className={styles.pending}>
          Waiting on {pending.map((id) => (id === mySteamId ? "you" : names[id] ?? "a player")).join(", ")}
        </p>
      )}
    </section>
  );
}
