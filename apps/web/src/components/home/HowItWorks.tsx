import styles from "./home.module.css";

const STEPS = [
  { title: "Sign in with Steam", body: "We will never ask for your credentials, sign in securely via Steam." },
  { title: "Grab your mates and play", body: "Solo queue or party up and queue for one or more modes you want to play." },
  { title: "Show your skill", body: "Join the server, and show off your skill to improve your rating." },
];

// Three steps from landing to playing
export function HowItWorks() {
  return (
    <section aria-labelledby="how-heading">
      <h2 id="how-heading" className={styles.sectionTitle}>
        How it works
      </h2>
      <HowItWorksSteps />
    </section>
  );
}

// The steps alone. stacked puts them in one column inside a panel, like the Play rail for guests
export function HowItWorksSteps({ stacked = false }: { stacked?: boolean }) {
  return (
    <ol className={stacked ? styles.stepsStacked : `glass ${styles.steps}`}>
      {STEPS.map((s, i) => (
        <li key={s.title} className={styles.step}>
          <span className={styles.stepNum} aria-hidden="true">
            {i + 1}
          </span>
          <span className={styles.stepText}>
            <span className={styles.stepTitle}>{s.title}</span>
            <span>{s.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
