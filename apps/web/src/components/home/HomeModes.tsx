import { MODES, RANKED_MODES, isRushMode, isTestMode, type Mode } from "@rushsite/shared";
import Link from "next/link";
import { MODE_ART, MODE_COPY } from "@/lib/modes";
import { modePath } from "@/lib/seo";
import styles from "./home.module.css";

// The three rated modes as picture tiles, Rush first, then the unrated test modes in a smaller row
export function HomeModes() {
  const modes = [...RANKED_MODES].sort((a, b) => Number(isRushMode(b)) - Number(isRushMode(a)));
  const experimental = MODES.filter(isTestMode);
  return (
    <section aria-labelledby="modes-heading">
      <h2 id="modes-heading" className={styles.sectionTitle}>
        Modes
      </h2>
      <ul className={styles.modes}>
        {modes.map((mode) => (
          <li key={mode}>
            <ModeTile mode={mode} />
          </li>
        ))}
      </ul>
      {experimental.length > 0 && (
        <>
          <h3 className={styles.subTitle}>Experimental</h3>
          <ul className={styles.modesSmall}>
            {experimental.map((mode) => (
              <li key={mode}>
                <ModeTile mode={mode} small />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ModeTile({ mode, small = false }: { mode: Mode; small?: boolean }) {
  const copy = MODE_COPY[mode];
  const href = modePath(mode);
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.modeArt} src={MODE_ART[mode]} alt="" />
      <span className={styles.modeShade} />
      {small && <span className={styles.modeTag}>Unrated</span>}
      <span className={styles.modeText}>
        <span className={styles.modeName}>
          <span className={styles.modeFormat}>{copy.format}</span> {copy.name}
        </span>
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={styles.mode} data-small={small || undefined}>
      {body}
    </Link>
  ) : (
    <div className={styles.mode} data-small={small || undefined}>
      {body}
    </div>
  );
}
