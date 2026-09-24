import type { TeamSide } from "@/components/ui/TeamMarker";
import styles from "./Rush.module.css";

// Our own CT and T marks for a castle: a shield for CT, a sharp diamond for T, in the colour of the team playing it
export function SideEmblem({ play, side }: { play: "ct" | "t"; side?: TeamSide }) {
  return (
    <span className={styles.emblem} data-play={play} data-side={side} aria-hidden="true">
      <svg viewBox="0 0 32 32" width="100%" height="100%">
        {play === "ct" ? (
          <path d="M16 2 L28 6.5 V15 C28 22.5 22.8 27.6 16 30 C9.2 27.6 4 22.5 4 15 V6.5 Z" />
        ) : (
          <path d="M16 1.5 L30.5 16 L16 30.5 L1.5 16 Z" />
        )}
        <text x="16" y={play === "ct" ? 19.5 : 20.5} textAnchor="middle">
          {play === "ct" ? "CT" : "T"}
        </text>
      </svg>
    </span>
  );
}
