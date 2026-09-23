import { cx } from "./cx";
import styles from "./MapCard.module.css";

export type MapCardState = "available" | "banned" | "picked" | "decider";

type MapCardProps = {
  mapId: string;
  name: string;
  state?: MapCardState;
  // Current viewer voted for this map
  voted?: boolean;
  // Votes from the acting team for the current step
  votes?: number;
  // Short note under the name, like "Banned by you"
  note?: string;
  // Makes the card a button
  onSelect?: () => void;
  disabled?: boolean;
  actionLabel?: string;
};

export function MapCard({ mapId, name, state = "available", voted, votes, note, onSelect, disabled, actionLabel = "Ban" }: MapCardProps) {
  const body = (
    <>
      <span className={styles.top}>
        <span className={cx(styles.name, "mono")}>{name}</span>
        {votes !== undefined && votes > 0 && (
          <span className={cx(styles.votes, "mono")}>
            {votes}
            <span className="visually-hidden"> {votes === 1 ? "vote" : "votes"}</span>
          </span>
        )}
      </span>
      <span className={styles.bottom}>
        {state === "banned" && <span className={styles.stateLoss}>Banned</span>}
        {state === "picked" && <span className={styles.stateAccent}>Picked</span>}
        {state === "decider" && <span className={styles.stateWin}>Playing</span>}
        {state === "available" && voted && <span className={styles.stateAccent}>Your vote</span>}
        {note && <span className={styles.note}>{note}</span>}
      </span>
    </>
  );
  const cls = cx(styles.card, styles[state], voted && styles.voted, onSelect && !disabled && styles.interactive);
  if (onSelect) {
    return (
      <button
        type="button"
        className={cls}
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={voted}
        aria-label={`${actionLabel} ${name}${voted ? ", your vote" : ""}${votes ? `, ${votes} votes` : ""}`}
        data-map={mapId}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-map={mapId}>
      {body}
    </div>
  );
}
