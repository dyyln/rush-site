import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import styles from "@/app/play/play.module.css";
import own from "./skeletons.module.css";

// Play page mode cards while the session loads
export function PlaySkeleton() {
  return (
    <SkeletonRegion label="Loading play" className="container page">
      <header className="page-header">
        <div>
          <h1>Play</h1>
          <p>Pick your modes.</p>
        </div>
      </header>
      <div className="grid-2">
        <div className="stack">
          <div>
            <p className={styles.legend}>Modes</p>
            <ul className={styles.modes}>
              {[0, 1, 2].map((i) => (
                <li key={i}>
                  <div className={`${styles.mode} ${own.static}`}>
                    <Skeleton height="1.75rem" width="70%" />
                    <Skeleton width="55%" />
                    <Skeleton shape="block" width={96} height={22} className={own.chip} />
                    <Skeleton width="80%" height="0.75rem" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.queueBar}>
            <Skeleton shape="block" width={240} height={44} className={own.button} />
            <Skeleton shape="block" width={180} height={56} className={own.button} />
          </div>
        </div>
        <div className="stack">
          <Skeleton shape="block" height={220} width="100%" />
        </div>
      </div>
    </SkeletonRegion>
  );
}
