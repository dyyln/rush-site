import type { TrustRequirementStatus } from "@/lib/trust";
import styles from "./trust.module.css";

export function TrustChecklist({ requirements }: { requirements: TrustRequirementStatus[] }) {
  return (
    <ul className={styles.checklist}>
      {requirements.map((r) => (
        <li key={r.key} className={r.met ? styles.met : styles.unmet}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={styles.tick}>
            {r.met ? (
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            )}
          </svg>
          <span className={styles.label}>
            {r.label}
            <span className="visually-hidden">{r.met ? ", done" : ", not yet"}</span>
          </span>
          {r.progress && (
            <span className={`${styles.count} mono`}>
              {Math.min(r.progress.current, r.progress.required)}/{r.progress.required}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
