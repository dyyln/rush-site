import { cx } from "@/components/ui/cx";
import { Throbber } from "@/components/ui/Throbber";
import styles from "./ConnectSteps.module.css";

export type ConnectStep = "allocating" | "starting" | "waiting";

const STEPS: { id: ConnectStep; label: string; hint: string }[] = [
  { id: "allocating", label: "Allocating server", hint: "Finding a free server slot near you." },
  { id: "starting", label: "Starting server", hint: "Loading the map and match config. Connect details appear when it is up." },
  { id: "waiting", label: "Waiting for players", hint: "Connect now. The match starts when everyone is in." },
];

// Shows where the server is in its start up so players know what they are waiting for
// hint: false when the panel around it already says what is happening
export function ConnectSteps({ step, connected, expected, hint = true }: { step: ConnectStep; connected?: number; expected?: number; hint?: boolean }) {
  const current = STEPS.findIndex((s) => s.id === step);
  const active = STEPS[current]!;
  return (
    <div className={styles.wrap}>
      <ol className={styles.steps} aria-label="Server progress">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s.id} className={cx(styles.step, styles[state])} aria-current={state === "current" ? "step" : undefined}>
              <span className={styles.mark} aria-hidden="true">
                {state === "done" ? (
                  <svg width="12" height="12" viewBox="0 0 16 16">
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : state === "current" ? (
                  <Throbber />
                ) : null}
              </span>
              <span className={styles.label}>
                {s.label}
                {state === "done" && <span className="visually-hidden">, done</span>}
              </span>
              {s.id === "waiting" && state === "current" && expected !== undefined && connected !== undefined && (
                <span className={cx(styles.count, "mono")}>
                  {connected} of {expected}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {hint && (
        <p className={styles.hint} aria-live="polite">
          {active.hint}
        </p>
      )}
    </div>
  );
}
