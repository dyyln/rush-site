import type { ReactNode } from "react";
import styles from "./guide.module.css";

type Props = { kicker: string; title: string; lede: string; art: string | null; children?: ReactNode };

// Banner with art behind a scrim, like the home hero but shorter
export function GuideHero({ kicker, title, lede, art, children }: Props) {
  return (
    <header className={styles.hero}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {art && <img className={styles.heroArt} src={art} alt="" />}
      <span className={styles.heroShade} />
      <p className={styles.kicker}>{kicker}</p>
      <h1 className={styles.heroTitle}>{title}</h1>
      <p className={styles.lede}>{lede}</p>
      {children && <div className={styles.heroActions}>{children}</div>}
    </header>
  );
}
