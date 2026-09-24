import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { cx } from "@/components/ui/cx";
import styles from "@/app/matches/[id]/match.module.css";
import actionStyles from "@/components/match/MatchActions.module.css";
import result from "@/components/match/ResultHeader.module.css";
import own from "./MatchSkeleton.module.css";

// The match room while it loads: the hero banner with its title, meta, actions and score, the tab row and
// both team panels. Built from the room's own classes so the real page lands without a jump. Most links
// lead to a finished match, so it shows that layout
export function MatchSkeleton() {
  return (
    <SkeletonRegion label="Loading match" className="container page">
      <div className={styles.hero}>
        <span className={cx(styles.heroArt, own.art)} aria-hidden="true" />
        <span className={styles.heroShade} aria-hidden="true" />
        <div className={styles.headTop}>
          <div className={styles.heroTitle}>
            <div className={styles.titleLine}>
              <Skeleton shape="block" width="min(12rem, 55vw)" className={own.title} />
              <Skeleton shape="block" width={72} height={22} className={own.chip} />
            </div>
            <p className={cx(styles.heroMeta, own.meta)}>
              <Skeleton width={148} />
            </p>
          </div>
          <div className={actionStyles.actions}>
            {[120, 204, 124, 132].map((w, i) => (
              <Skeleton key={i} shape="block" width={w} height={44} className={own.button} />
            ))}
          </div>
        </div>
        <div className={styles.heroScore}>
          <div className={result.result}>
            <div className={result.strip}>
              {(["end", "start"] as const).map((align, i) => (
                <div key={align} className={result.team} data-align={align} style={{ order: i * 2 }}>
                  <span className={cx(result.teamName, own.teamName)}>
                    <Skeleton width={84} />
                  </span>
                  <span className={result.avatars}>
                    {[0, 1, 2].map((j) => (
                      <span key={j} className={result.avatarLink}>
                        <Skeleton shape="avatar" width={28} height={28} />
                      </span>
                    ))}
                  </span>
                </div>
              ))}
              <span className={result.score} style={{ order: 1 }}>
                <Skeleton shape="block" width="1.7em" height="1em" className={own.chip} />
              </span>
            </div>
            <div className={result.line}>
              <Skeleton width={96} height="1.5rem" />
              <Skeleton width={72} />
              <Skeleton shape="pill" width={128} height={44} />
            </div>
          </div>
        </div>
      </div>

      <div className={own.below}>
        <div className={own.tabs}>
          {[112, 76].map((w, i) => (
            <span key={i} className={own.tab}>
              <Skeleton width={w} height="1.1rem" />
            </span>
          ))}
        </div>

        <div className={styles.tables}>
          {[0, 1].map((i) => (
            <div key={i} className={cx("glass", styles.teamPanel)} data-side={i === 0 ? "own" : "enemy"}>
              <div className={styles.teamHeading}>
                <Skeleton width={96} height="1.1rem" className={own.heading} />
              </div>
              <div className={own.tableHead}>
                <Skeleton width={44} height="0.7rem" />
              </div>
              {[0, 1, 2].map((j) => (
                <div key={j} className={own.tableRow}>
                  <Skeleton width={j === 1 ? 72 : 96} />
                  <Skeleton shape="block" width={64} height={20} className={own.chip} />
                  <span className={own.stats}>
                    {[20, 20, 20, 36].map((w, k) => (
                      <Skeleton key={k} width={w} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
