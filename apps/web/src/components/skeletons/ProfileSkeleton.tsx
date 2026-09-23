import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import styles from "@/app/profile/[steamId]/profile.module.css";
import own from "./skeletons.module.css";

// Profile hero and rating cards while the profile loads
export function ProfileSkeleton() {
  return (
    <SkeletonRegion label="Loading profile" className="container page">
      <div className={styles.hero}>
        <Skeleton shape="avatar" width={72} height={72} />
        <div className={styles.heroText}>
          <Skeleton height="2.25rem" width={220} />
          <div className="row">
            <Skeleton shape="block" width={84} height={24} className={own.chip} />
            <Skeleton shape="block" width={40} height={24} className={own.chip} />
            <Skeleton width={96} />
            <Skeleton shape="block" width={112} height={44} className={own.button} />
          </div>
        </div>
      </div>
      <ul className={styles.ratings}>
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <div className={`${styles.ratingCard} ${own.static}`}>
              <Skeleton width={72} height="0.75rem" />
              <Skeleton shape="block" width={120} height={26} className={own.chip} />
              <Skeleton width={80} />
              <Skeleton shape="block" height={40} width="100%" className={own.spark} />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonRegion>
  );
}
