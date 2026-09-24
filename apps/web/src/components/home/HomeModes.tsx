import { RANKED_MODES, isRushMode } from "@rushsite/shared";
import { MODE_ART, MODE_COPY } from "@/lib/modes";
import styles from "./home.module.css";

// The three modes as picture tiles, Rush first
export function HomeModes() {
  const modes = [...RANKED_MODES].sort((a, b) => Number(isRushMode(b)) - Number(isRushMode(a)));
  return (
    <section aria-labelledby="modes-heading">
      <h2 id="modes-heading" className={styles.sectionTitle}>
        Modes
      </h2>
      <ul className={styles.modes}>
        {modes.map((mode) => {
          const copy = MODE_COPY[mode];
          return (
            <li key={mode}>
              <div className={styles.mode}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.modeArt} src={MODE_ART[mode]} alt="" />
                <span className={styles.modeShade} />
                <span className={styles.modeFormat}>{copy.format}</span>
                <span className={styles.modeText}>
                  <span className={styles.modeName}>{copy.name}</span>
                  <span className={styles.modeBlurb}>{copy.blurb}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
