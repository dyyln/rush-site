import styles from "./home.module.css";

const STEPS = [
  { title: "Sign in with Steam", body: "Your Steam account is your identity. No new password." },
  { title: "Pick modes, press GO", body: "Queue solo or with your party for one or more modes at once." },
  { title: "Accept, veto, connect", body: "Accept in 20 seconds, vote on the maps, then join the server from the dock." },
];

// Three steps from landing to playing, straight on the scene
export function HowItWorks() {
  return (
    <section aria-labelledby="how-heading">
      <h2 id="how-heading" className={styles.sectionTitle}>
        How it works
      </h2>
      <ol className={styles.steps}>
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
    </section>
  );
}
