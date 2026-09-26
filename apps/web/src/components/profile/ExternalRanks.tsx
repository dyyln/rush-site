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

// The source name centred above its rank icon
function RankTile({ name, href, title, children, sub }: TileProps) {
  const body = (
    <>
      <span className={styles.name}>{name}</span>
      <span className={styles.icon}>{children}</span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </>
  );
  return href ? (
    <a className={styles.tile} href={href} target="_blank" rel="noopener noreferrer" title={title} aria-label={title}>
      {body}
    </a>
  ) : (
    <span className={styles.tile} title={title} aria-label={title} role="img">
      {body}
    </span>
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
              <img src={`/ranks/faceit/${level}.svg`} alt="" width={36} height={36} />
            </RankTile>
          </li>
        )}
        {premier !== null && (
          <li>
            <RankTile name="Premier" href={leetify?.url} title={`Premier CS Rating ${premier.toLocaleString("en-GB")}`}>
              <span className={styles.premier} style={{ "--band": premierColor(premier) } as React.CSSProperties}>
                {premier.toLocaleString("en-GB")}
              </span>
            </RankTile>
          </li>
        )}
        {group && (
          <li>
            <RankTile name="Wingman" href={leetify?.url} title={`Wingman rank ${WINGMAN[group - 1]}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/ranks/wingman/${group}.webp`} alt="" width={80} height={33} />
            </RankTile>
          </li>
        )}
      </ul>
      {fromLeetify && (
        <p className={styles.credit}>
          <a href="https://leetify.com/" target="_blank" rel="noopener noreferrer">
            Data provided by Leetify
          </a>
          <a href={leetify!.url} target="_blank" rel="noopener noreferrer">
            View on Leetify
          </a>
        </p>
      )}
    </div>
  );
}
