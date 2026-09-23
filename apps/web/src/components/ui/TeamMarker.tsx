import styles from "./TeamMarker.module.css";

export type TeamSide = "own" | "enemy";

// Square for own team, diamond for enemy, so teams differ by shape as well as colour
export function TeamMarker({ side, label }: { side: TeamSide; label?: string }) {
  return (
    <svg
      className={styles.marker}
      data-side={side}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {side === "own" ? <rect x="1" y="1" width="8" height="8" fill="currentColor" /> : <path d="M5 0l5 5-5 5-5-5z" fill="currentColor" />}
    </svg>
  );
}
