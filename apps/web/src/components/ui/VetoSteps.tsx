import type { TeamSide } from "./TeamMarker";
import { cx } from "./cx";
import styles from "./VetoSteps.module.css";

export type VetoStepItem = {
  // Such as "Ban" or "Mid"
  action: string;
  // Such as "You", "Opp" or a team name
  team: string;
  owner: TeamSide;
  status: "done" | "current" | "upcoming";
  // Spoken after the step, such as the map it took
  result?: string;
};

// The veto order as a line of text with arrows. The team colour says who acts, done steps dim and the current one is bold
export function VetoSteps({ steps, label }: { steps: VetoStepItem[]; label: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className={styles.steps} aria-label={label}>
      {steps.map((s, i) => (
        <li key={i} className={cx(styles.step, styles[s.status])} data-owner={s.owner} aria-current={s.status === "current" ? "step" : undefined}>
          <span className={styles.action}>{s.action}</span> <span className={styles.team}>{s.team}</span>
          {s.result && <span className="visually-hidden">, {s.result}</span>}
        </li>
      ))}
    </ol>
  );
}
