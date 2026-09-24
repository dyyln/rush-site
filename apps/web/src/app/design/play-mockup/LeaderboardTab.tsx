"use client";

import { useState } from "react";
import { tierForRating } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { TierChip } from "@/components/ui/TierChip";
import { cx } from "@/components/ui/cx";
import styles from "./tabs.module.css";

// Mockup only. Fake ladder for the Leaderboard tab

type ModeKey = "rush" | "aim1" | "aim2";
const MODES: { value: ModeKey; label: string }[] = [
  { value: "rush", label: "3v3 Rush" },
  { value: "aim1", label: "1v1 Aim" },
  { value: "aim2", label: "2v2 Aim" },
];
const NAMES = [
  "vanta",
  "kestrel",
  "oxbow",
  "lune",
  "ferro",
  "ash",
  "juno",
  "quill",
  "sable",
  "wren",
  "tomas",
  "aster",
  "ren",
  "bo",
  "mira",
  "cinder",
  "halo",
  "pike",
];

type Row = {
  rank: number;
  name: string;
  rating: number;
  matches: number;
  winRate: number;
  delta: number;
};

// Same numbers every render, different per mode
function ladder(mode: ModeKey): Row[] {
  const seed = mode === "rush" ? 7 : mode === "aim1" ? 13 : 29;
  let x = seed;
  const rnd = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  let rating = mode === "rush" ? 2486 : mode === "aim1" ? 2611 : 2390;
  const offset = mode === "rush" ? 0 : mode === "aim1" ? 5 : 11;
  return Array.from({ length: 15 }, (_, i) => {
    rating -= Math.round(8 + rnd() * 34);
    return {
      rank: i + 1,
      name: NAMES[(i + offset) % NAMES.length]!,
      rating,
      matches: Math.round(60 + rnd() * 400),
      winRate: Math.round(52 + rnd() * 20),
      delta: Math.round((rnd() - 0.35) * 40),
    };
  });
}

const YOU: Record<ModeKey, Row | null> = {
  rush: {
    rank: 214,
    name: "meridius",
    rating: 1712,
    matches: 58,
    winRate: 57,
    delta: 14,
  },
  aim1: {
    rank: 488,
    name: "meridius",
    rating: 1455,
    matches: 28,
    winRate: 50,
    delta: -9,
  },
  aim2: null,
};

function Delta({ v }: { v: number }) {
  if (v === 0) return <span className={cx(styles.delta, "mono")}>0</span>;
  return (
    <span className={cx(styles.delta, "mono")} data-dir={v > 0 ? "up" : "down"}>
      {v > 0 ? "+" : "−"}
      {Math.abs(v)}
      <span className="visually-hidden"> this week</span>
    </span>
  );
}

export function LeaderboardTab() {
  const [mode, setMode] = useState<ModeKey>("rush");
  const rows = ladder(mode);
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);
  const you = YOU[mode];

  return (
    <div className={styles.stack}>
      <div className={styles.lbHead}>
        <div className={styles.filters} role="group" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.value} type="button" aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>
              {m.label}
            </button>
          ))}
        </div>
        <span className={styles.lbNote}>Global · Updated live</span>
      </div>

      {/* Top 3, 2nd and 3rd either side of 1st */}
      <ol className={styles.podium}>
        {[top[1]!, top[0]!, top[2]!].map((r) => (
          <li key={r.rank} className={styles.podiumCard} data-place={r.rank}>
            <span className={cx(styles.place, "mono")}>{r.rank}</span>
            <Avatar name={r.name} size="lg" />
            <span className={styles.podiumName}>{r.name}</span>
            <TierChip tier={tierForRating(r.rating).id} rating={r.rating} size="sm" link={false} />
            <span className={styles.podiumMeta}>
              <span className="mono">{r.winRate}%</span> win · <span className="mono">{r.matches}</span> matches
            </span>
          </li>
        ))}
      </ol>

      <div className={cx("glass", styles.panel)}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col">Rating</th>
              <th scope="col" className={styles.hideSm}>
                Matches
              </th>
              <th scope="col" className={styles.hideSm}>
                Win rate
              </th>
              <th scope="col">7 days</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((r) => (
              <tr key={r.rank}>
                <td className="mono">{r.rank}</td>
                <td>
                  <span className={styles.player}>
                    <Avatar name={r.name} size="sm" />
                    {r.name}
                  </span>
                </td>
                <td>
                  <TierChip tier={tierForRating(r.rating).id} rating={r.rating} size="sm" link={false} />
                </td>
                <td className={cx("mono", styles.hideSm)}>{r.matches}</td>
                <td className={cx("mono", styles.hideSm)}>{r.winRate}%</td>
                <td>
                  <Delta v={r.delta} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* You stay pinned under the list, however far down you are */}
        <div className={styles.youRow}>
          {you ? (
            <>
              <span className={cx(styles.youRank, "mono")}>#{you.rank}</span>
              <span className={styles.player}>
                <Avatar name={you.name} size="sm" />
                <span>
                  {you.name} <span className={styles.youTag}>You</span>
                </span>
              </span>
              <TierChip tier={tierForRating(you.rating).id} rating={you.rating} size="sm" link={false} />
              <span className={cx("mono", styles.hideSm)}>{you.winRate}% win</span>
              <Delta v={you.delta} />
            </>
          ) : (
            <span className="muted">Play one 2v2 Aim match to get on this board.</span>
          )}
        </div>
      </div>
    </div>
  );
}
