import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import styles from "@/app/play/play.module.css";

// Play page mode tiles while the session loads
export function PlaySkeleton() {
  return (
    <SkeletonRegion label="Loading play" className={`container ${styles.page}`}>
      <div className={styles.main}>
        <div className={styles.center}>
          <ul className={styles.tiles}>
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton shape="block" width="100%" height={340} />
              </li>
            ))}
          </ul>
        </div>
        <Skeleton shape="block" height={420} width="100%" />
      </div>
    </SkeletonRegion>
  );
}
