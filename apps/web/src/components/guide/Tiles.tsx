import Link from "next/link";
import styles from "./guide.module.css";

export type TileItem = { key: string; name: string; sub?: string; art: string | null; href?: string };

// Picture tiles. Items with an href become links
export function Tiles({ items, size }: { items: TileItem[]; size?: "sm" | "lg" }) {
  return (
    <ul className={styles.tiles} data-size={size}>
      {items.map((t) => {
        const body = (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.art && <img className={styles.tileArt} src={t.art} alt="" loading="lazy" />}
            <span className={styles.tileShade} />
            <span className={styles.tileName}>{t.name}</span>
            {t.sub && <span className={styles.tileSub}>{t.sub}</span>}
          </>
        );
        return (
          <li key={t.key}>
            {t.href ? (
              <Link href={t.href} className={styles.tile}>
                {body}
              </Link>
            ) : (
              <div className={styles.tile}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
