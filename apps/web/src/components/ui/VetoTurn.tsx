import type { VetoState } from "@rushsite/shared";
import { cx } from "./cx";
import styles from "./VetoTurn.module.css";

// Whose move it is, from the viewer's seat. Every veto header, card grid and step strip reads this
// mine: the viewer's team acts and the viewer has not voted. voted: the viewer voted, teammates may still be voting.
// theirs: the other team acts. watching: the viewer is not playing
export type VetoTurn = "mine" | "voted" | "theirs" | "watching" | "done";

export function vetoTurn(state: VetoState, myTeam: 0 | 1 | null, mySteamId: string): VetoTurn {
  const step = state.done ? null : state.steps[state.stepIndex];
  if (!step) return "done";
  if (myTeam === null) return "watching";
  if (step.team !== myTeam) return "theirs";
  return mySteamId in state.votes ? "voted" : "mine";
}

// True when the viewer's team acts on the step after this one
export function nextIsMine(state: VetoState, myTeam: 0 | 1 | null): boolean {
  if (state.done || myTeam === null) return false;
  const now = state.steps[state.stepIndex];
  const next = state.steps[state.stepIndex + 1];
  return !!next && now?.team !== myTeam && next.team === myTeam;
}

// "Waiting on Ana, Bo" for the teammates still to vote, or null once everyone has
export function waitingOn(state: VetoState, mySteamId: string, names: Record<string, string>): string | null {
  const step = state.done ? null : state.steps[state.stepIndex];
  if (!step) return null;
  const pending = state.teams[step.team].steamIds.filter((id) => !(id in state.votes));
  if (pending.length === 0) return null;
  return `Waiting on ${pending.map((id) => (id === mySteamId ? "you" : (names[id] ?? "a player"))).join(", ")}`;
}

const CHIP: Record<Exclude<VetoTurn, "done">, string> = {
  mine: "Your turn",
  voted: "Vote in",
  theirs: "Opponents' turn",
  watching: "Live",
};

// Label in front of the headline. Says in words what the band colour says
export function VetoTurnChip({ turn, next }: { turn: VetoTurn; next?: boolean }) {
  if (turn === "done") return null;
  return (
    <span className={styles.chips}>
      <span className={styles.chip} data-turn={turn}>
        {CHIP[turn]}
      </span>
      {next && turn === "theirs" && <span className={cx(styles.chip, styles.next)}>You&apos;re next</span>}
    </span>
  );
}

// Class names the boards put on their header, card grid and steps
export const turnClass = {
  band: styles.band,
  grid: styles.grid,
  step: styles.step,
};
