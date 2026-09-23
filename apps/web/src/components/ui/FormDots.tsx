import { cx } from "./cx";
import styles from "./FormDots.module.css";

export type FormResult = "win" | "loss" | "abandoned";

const FORM: Record<FormResult, { letter: string; word: string }> = {
  win: { letter: "W", word: "Win" },
  loss: { letter: "L", word: "Loss" },
  abandoned: { letter: "A", word: "Abandoned" },
};

type FormDotsProps = {
  results: { id: string; result: FormResult }[];
  // Read before the results by screen readers
  label?: string;
  className?: string;
};

// Result markers that carry a letter and a shape as well as colour
export function FormDots({ results, label = "Recent form, oldest first", className }: FormDotsProps) {
  const words = results.map((r) => FORM[r.result].word.toLowerCase()).join(", ");
  return (
    <span className={cx(styles.dots, className)} role="img" aria-label={`${label}: ${words}`}>
      {results.map((r) => (
        <span key={r.id} className={styles.dot} data-result={r.result} title={FORM[r.result].word} aria-hidden="true">
          {FORM[r.result].letter}
        </span>
      ))}
    </span>
  );
}
