import styles from "./leaderboard.module.css";

const PLACE = { 1: "gold", 2: "silver", 3: "bronze" } as const;
const LABEL = { 1: "1st place", 2: "2nd place", 3: "3rd place" } as const;

// Small medal for the top three. Tints come from the credits token and neutrals in the module css
export function Medal({ rank }: { rank: 1 | 2 | 3 }) {
  return (
    <span className={`${styles.medal} ${styles[PLACE[rank]]}`}>
      <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true" focusable="false">
        <path d="M5 1h4l3 7H8z" className={styles.ribbon} />
        <path d="M17 1h-4l-3 7h4z" className={styles.ribbonFar} />
        <circle cx="11" cy="16.5" r="8" className={styles.disc} />
        <circle cx="11" cy="16.5" r="5.6" className={styles.ring} />
        <text x="11" y="16.5" dy="0.35em" textAnchor="middle" className={styles.numeral}>
          {rank}
        </text>
      </svg>
      <span className="visually-hidden">{LABEL[rank]}</span>
    </span>
  );
}
