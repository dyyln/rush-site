import type { TrustStatus } from "@/lib/trust";
import styles from "./trust.module.css";

// Something outside the player's control is holding promotion back
export function TrustBlocked({ trust }: { trust: TrustStatus }) {
  if (!trust.blockedBy) return null;
  return (
    <p className={styles.blocked} role="note">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5l7 12.5H1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 6v3.5M8 11.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>{trust.blockedBy}</span>
    </p>
  );
}
