"use client";

import { VETO_STEP_SEC, type Mode, type VetoState } from "@rushsite/shared";
import { mapName } from "@/lib/modes";
import { VetoSummary } from "@/components/play/VetoSummary";
import { useVetoTicks } from "@/components/play/useVetoTicks";
import { MapCard, type MapCardState, type MapCardVoter } from "./MapCard";
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
  useVetoTicks(state.done ? null : stepDeadline, myTurn && !myVote && frozenSec === undefined);
  const lastAuto = state.history.at(-1)?.noVotes ? state.history.at(-1) : undefined;

  const teamLabel = (t: 0 | 1) => (t === myTeam ? "your team" : `Team ${t === 0 ? "A" : "B"}`);
  const actingSide = step ? (step.team === myTeam ? "own" : "enemy") : "own";

  // Acting team members who voted for this map, in team order
  function votersFor(mapId: string): MapCardVoter[] {
    if (!actingTeam) return [];
    return actingTeam.steamIds
      .filter((id) => state.votes[id] === mapId)
      .map((id) => ({ steamId: id, name: id === mySteamId ? "You" : (names[id] ?? "Player"), me: id === mySteamId }));
  }

  function cardState(mapId: string): { state: MapCardState; by?: { label: string; side: "own" | "enemy" }; tag?: string } {
    const h = state.history.find((e) => e.mapId === mapId);
    if (h) {
      return {
        state: h.action === "ban" ? "banned" : "picked",
        by: { label: teamLabel(h.team), side: h.team === myTeam ? "own" : "enemy" },
        tag: h.noVotes ? "auto" : h.tieBroken ? "tie" : undefined,
      };
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
          {lastAuto && !state.done && (
            <p className={styles.sub} role="status">
              Time ran out. {mapName(mode, lastAuto.mapId)} was auto-{lastAuto.action === "ban" ? "banned" : "picked"}.
            </p>
          )}
          <VetoSummary mode={mode} state={state} mySteamId={mySteamId} />
        </div>
        {!state.done && stepDeadline !== null && (
          <Timer until={stepDeadline} frozenSec={frozenSec} totalSec={VETO_STEP_SEC} label={myTurn ? "Your turn" : "Their turn"} size="lg" />
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
              className={cx("glass", styles.step, done && styles.stepDone, current && styles.stepCurrent, s.team === myTeam ? styles.stepUs : styles.stepThem)}
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
                by={cs.by}
                tag={cs.tag}
                voted={myVote === mapId}
                votes={cs.state === "available" ? voteCounts.get(mapId) : undefined}
                voters={cs.state === "available" && actingTeam ? votersFor(mapId) : undefined}
                voterTotal={actingTeam?.steamIds.length}
                voterSide={actingSide}
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
