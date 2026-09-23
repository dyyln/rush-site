import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import styles from "@/app/matches/[id]/match.module.css";
import actionStyles from "@/components/match/MatchActions.module.css";
import own from "./skeletons.module.css";

// Match header and scoreboard while the match loads
export function MatchSkeleton() {
  return (
    <SkeletonRegion label="Loading match" className="container page">
      <div className={styles.header}>
        <div className="row">
          <Skeleton shape="block" width={72} height={24} className={own.chip} />
          <Skeleton width={64} height="0.75rem" />
          <Skeleton width={88} />
        </div>
        <div className={actionStyles.actions}>
          <Skeleton shape="block" width={112} height={44} className={own.button} />
        </div>
      </div>
      <div className={styles.scoreboard}>
        {[0, 1].map((i) => (
          <div key={i} className={styles.team} style={{ order: i * 2 }}>
            <Skeleton shape="block" width={72} height={64} className={own.button} />
            <Skeleton width={96} />
            <span className={own.avatars}>
              {[0, 1, 2].map((j) => (
                <Skeleton key={j} shape="avatar" width={28} height={28} />
              ))}
            </span>
          </div>
        ))}
        <span className={styles.dash} style={{ order: 1 }} aria-hidden="true">
          :
        </span>
      </div>
    </SkeletonRegion>
  );
}
