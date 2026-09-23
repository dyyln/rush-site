import { BRAND_NAME } from "@rushsite/shared";
import { ButtonLink } from "@/components/ui/Button";
import styles from "./home.module.css";

export default function HomePage() {
  return (
    <div className={`container page ${styles.home}`}>
      <p className="eyebrow">For CS2</p>
      <h1 className={styles.title}>Short matches. Real ladder.</h1>
      <p className={styles.lede}>
        Queue 1v1 Aim, 2v2 Aim or 3v3 Rush on {BRAND_NAME} servers. Every mode has its own rating. Free daily and weekly
        cups for Verified players.
      </p>
      <div className="row">
        <ButtonLink href="/play" size="lg">
          Play now
        </ButtonLink>
        <ButtonLink href="/leaderboard" size="lg" variant="secondary">
          Leaderboard
        </ButtonLink>
      </div>
    </div>
  );
}
