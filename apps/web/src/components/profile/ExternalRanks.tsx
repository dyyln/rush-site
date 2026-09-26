"use client";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import styles from "./ExternalRanks.module.css";

const WINGMAN = [
  "Silver I",
  "Silver II",
  "Silver III",
  "Silver IV",
  "Silver Elite",
  "Silver Elite Master",
  "Gold Nova I",
  "Gold Nova II",
  "Gold Nova III",
  "Gold Nova Master",
  "Master Guardian I",
  "Master Guardian II",
  "Master Guardian Elite",
  "Distinguished Master Guardian",
  "Legendary Eagle",
  "Legendary Eagle Master",
  "Supreme Master First Class",
  "Global Elite",
];

// CS Rating colour bands as the game shows them, lowest first
const PREMIER_BANDS: { min: number; color: string }[] = [
  { min: 0, color: "#b1c3d9" },
  { min: 5000, color: "#5e98d9" },
  { min: 10000, color: "#4b69ff" },
  { min: 15000, color: "#8847ff" },
  { min: 20000, color: "#d32ce6" },
  { min: 25000, color: "#eb4b4b" },
  { min: 30000, color: "#ffd700" },
];

function premierColor(rating: number): string {
  return [...PREMIER_BANDS].reverse().find((b) => rating >= b.min)!.color;
}

type TileProps = { name: string; href?: string | null; title: string; children: React.ReactNode; sub?: string };

// The source name centred above its rank icon. Only the icon links out
function RankTile({ name, href, title, children, sub }: TileProps) {
  return (
    <div className={styles.tile}>
      <span className={styles.name}>{name}</span>
      {href ? (
        <a className={styles.icon} href={href} target="_blank" rel="noopener noreferrer" title={title} aria-label={title}>
          {children}
        </a>
      ) : (
        <span className={styles.icon} title={title} role="img" aria-label={title}>
          {children}
        </span>
      )}
      <span className={styles.sub}>{sub ?? ""}</span>
    </div>
  );
}

// FACEIT, Premier and Wingman next to the name. Renders nothing until something is known
export function ExternalRanks({ steamId }: { steamId: string }) {
  const { data } = useAsync(() => api.userRanks(steamId), [steamId]);
  if (!data) return null;
  const { faceit, premier, wingman, leetify } = data;
  const level = faceit?.level && faceit.level >= 1 && faceit.level <= 10 ? faceit.level : null;
  const group = wingman && WINGMAN[wingman - 1] ? wingman : null;
  if (!level && premier === null && !group) return null;
  const faceitUrl = faceit?.nickname ? `https://www.faceit.com/en/players/${encodeURIComponent(faceit.nickname)}` : null;
  const fromLeetify = !!leetify && (premier !== null || group !== null || (!faceit?.nickname && level !== null));

  return (
    <div className={styles.wrap}>
      <ul className={styles.ranks} aria-label="Ranks elsewhere">
        {level && (
          <li>
            <RankTile
              name="FACEIT"
              href={faceitUrl ?? leetify?.url}
              title={`FACEIT level ${level}${faceit?.elo ? `, ${faceit.elo} Elo` : ""}`}
              sub={faceit?.elo ? String(faceit.elo) : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/ranks/faceit/${level}.svg`} alt="" width={34} height={34} />
            </RankTile>
          </li>
        )}
        {premier !== null && (
          <li>
            <RankTile name="Premier" href={leetify?.url} title={`Premier CS Rating ${premier.toLocaleString("en-GB")}${leetify ? ". View on Leetify" : ""}`}>
              <span className={styles.premier} style={{ "--band": premierColor(premier) } as React.CSSProperties}>
                {premier.toLocaleString("en-GB")}
              </span>
            </RankTile>
          </li>
        )}
        {group && (
          <li>
            <RankTile name="Wingman" href={leetify?.url} title={`Wingman rank ${WINGMAN[group - 1]}${leetify ? ". View on Leetify" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/ranks/wingman/${group}.webp`} alt="" width={76} height={31} />
            </RankTile>
          </li>
        )}
      </ul>
      {fromLeetify && (
        <a href="https://leetify.com/" target="_blank" rel="noopener noreferrer" className={styles.badge}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ranks/leetify-badge.png" alt="Data provided by Leetify" width={179} height={76} />
        </a>
      )}
    </div>
  );
}
