import { trustAtLeast } from "@rushsite/shared";
import { Card } from "@/components/ui/Card";
import type { TrustStatus } from "@/lib/trust";
import { TrustBlocked } from "./TrustBlocked";
import { TrustChecklist } from "./TrustChecklist";
import styles from "./trust.module.css";

// Shown on /play until the player is Verified
export function GetVerifiedCard({ trust }: { trust: TrustStatus | undefined }) {
  if (!trust || trustAtLeast(trust.level, "verified")) return null;
  return (
    <Card title="Get Verified" tone="raised" className={styles.card}>
      <p className={styles.unlocks}>Verified unlocks daily and weekly cups.</p>
      <TrustBlocked trust={trust} />
      <TrustChecklist requirements={trust.requirements} />
    </Card>
  );
}
