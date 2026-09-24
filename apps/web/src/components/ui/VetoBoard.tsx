"use client";

import { VETO_STEP_SEC, type Mode, type VetoState } from "@rushsite/shared";
import { useMapPool } from "@/lib/mapPool";
import { mapName } from "@/lib/modes";
import { VetoSummary } from "@/components/play/VetoSummary";
import { useVetoTicks } from "@/components/play/useVetoTicks";
import { MapCard, type MapCardState, type MapCardVoter } from "./MapCard";
import { VetoSteps } from "./VetoSteps";
import { VetoHead } from "@/components/ui/VetoHead";
import { nextIsMine, turnClass, vetoTurn, waitingOn } from "./VetoTurn";
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
  // Re-renders with admin set names once the live pool loads
  useMapPool();
  const myTeam = state.teams[0].steamIds.includes(mySteamId) ? 0 : 1;
  const step = state.done ? null : state.steps[state.stepIndex] ?? null;
  const myTurn = step?.team === myTeam;
  const myVote = state.votes[mySteamId];
  const voteCounts = new Map<string, number>();
  Object.values(state.votes).forEach((m) => voteCounts.set(m, (voteCounts.get(m) ?? 0) + 1));
  const actingTeam = step ? state.teams[step.team] : null;
  const turn = vetoTurn(state, myTeam, mySteamId);
  const next = nextIsMine(state, myTeam);
  const waiting = turn === "voted" ? waitingOn(state, mySteamId, names) : null;
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
        : step!.action === "pick"
          ? "Pick a map to play."
          : "Pick a map to ban."
      : "Waiting for opponents.";

  return (
    <section className={styles.board} aria-labelledby="veto-heading">
      <VetoHead
        id="veto-heading"
        eyebrow={`Map veto${step ? `, step ${state.stepIndex + 1} of ${state.steps.length}` : ""}`}
        turn={turn}
        next={next}
        headline={headline}
        sub={sub}
        notes={
          <>
            {waiting && <p className={styles.sub}>{waiting}.</p>}
            {lastAuto && !state.done && (
              <p className={styles.sub} role="status">
                Time ran out. {mapName(mode, lastAuto.mapId)} was auto-{lastAuto.action === "ban" ? "banned" : "picked"}.
              </p>
            )}
          </>
        }
        stepDeadline={stepDeadline}
        totalSec={VETO_STEP_SEC}
        frozenSec={frozenSec}
      >
        <VetoSummary mode={mode} state={state} mySteamId={mySteamId} />
      </VetoHead>

      <ul className={cx(styles.grid, turnClass.grid)} data-turn={turn} role="list">
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


      <VetoSteps
        label="Veto steps"
        steps={state.steps.map((s, i) => ({
          action: s.action,
          team: s.team === myTeam ? "You" : "Opponents",
          owner: s.team === myTeam ? "own" : "enemy",
          status: state.done || i < state.stepIndex ? "done" : i === state.stepIndex ? "current" : "upcoming",
          result: state.history[i] ? mapName(mode, state.history[i]!.mapId) : undefined,
        }))}
      />
    </section>
  );
}
