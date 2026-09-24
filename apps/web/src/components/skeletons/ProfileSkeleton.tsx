import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { cx } from "@/components/ui/cx";
import styles from "@/app/profile/[steamId]/profile.module.css";
import own from "./skeletons.module.css";

// Profile hero, sub-tabs and mode tiles while the profile loads
export function ProfileSkeleton() {
  return (
    <SkeletonRegion label="Loading profile" className={cx("container", styles.page)}>
      <div className={styles.hero}>
        <div className={styles.heroShade} />
        <div className={styles.heroMain}>
          <Skeleton shape="block" width={96} height={96} className={own.chip} />
          <div className={styles.heroText}>
            <Skeleton height="2.5rem" width={260} />
            <div className={styles.chips}>
              <Skeleton shape="block" width={84} height={24} className={own.chip} />
              <Skeleton shape="block" width={40} height={24} className={own.chip} />
              <Skeleton width={96} />
            </div>
            <Skeleton width={240} />
          </div>
        </div>
        <div className={cx(styles.heroTabs, styles.skeletonTabs)}>
          {[88, 80, 56].map((w) => (
            <Skeleton key={w} width={w} height="1rem" />
          ))}
        </div>
      </div>
      <ul className={styles.ratings}>
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <div className={cx(styles.ratingCard, own.static)}>
              <Skeleton width={96} height="1.1rem" />
              <Skeleton shape="block" width={120} height={26} className={own.chip} />
              <Skeleton width={100} />
              <Skeleton shape="block" height={40} width="100%" className={own.spark} />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonRegion>
  );
}
