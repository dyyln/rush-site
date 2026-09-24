"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { cx } from "@/components/ui/cx";
import styles from "./tabs.module.css";

// Mockup only. Fake cups for the Cups tab

type ModeKey = "rush" | "aim1" | "aim2";
type Cup = {
  id: string;
  name: string;
  mode: ModeKey;
  kind: "Daily" | "Weekly";
  day: string;
  time: string;
  entries: number;
  cap: number;
  art: string;
  status: "open" | "full" | "live";
  stage?: string;
};

const MODE_NAME: Record<ModeKey, string> = {
  rush: "3v3 Rush",
  aim1: "1v1 Aim",
  aim2: "2v2 Aim",
};

const CUPS: Cup[] = [
  {
    id: "a",
    name: "Weekly Aim Cup",
    mode: "aim1",
    kind: "Weekly",
    day: "Live",
    time: "now",
    entries: 64,
    cap: 64,
    art: "/maps/aim_map.webp",
    status: "live",
    stage: "Quarter-finals",
  },
  {
    id: "b",
    name: "Daily Rush Cup",
    mode: "rush",
    kind: "Daily",
    day: "Today",
    time: "20:00",
    entries: 22,
    cap: 32,
    art: "/backdrops/rush_001_2.webp",
    status: "open",
  },
  {
    id: "c",
    name: "Daily Aim Cup",
    mode: "aim2",
    kind: "Daily",
    day: "Today",
    time: "21:00",
    entries: 16,
    cap: 16,
    art: "/maps/aim_usp.webp",
    status: "full",
  },
  {
    id: "d",
    name: "Daily Aim Cup",
    mode: "aim1",
    kind: "Daily",
    day: "Today",
    time: "22:00",
    entries: 9,
    cap: 32,
    art: "/maps/aim_redline.webp",
    status: "open",
  },
  {
    id: "e",
    name: "Daily Rush Cup",
    mode: "rush",
    kind: "Daily",
    day: "Tomorrow",
    time: "20:00",
    entries: 3,
    cap: 32,
    art: "/backdrops/rush_001_1.webp",
    status: "open",
  },
  {
    id: "f",
    name: "Weekly Rush Cup",
    mode: "rush",
    kind: "Weekly",
    day: "Sunday",
    time: "18:00",
    entries: 41,
    cap: 64,
    art: "/backdrops/rush_001_4.webp",
    status: "open",
  },
];

const WINNERS = [
  {
    cup: "Daily Rush Cup",
    when: "Yesterday",
    team: "Team Halcyon",
    players: ["vanta", "oxbow", "lune"],
  },
  {
    cup: "Daily Aim Cup 1v1",
    when: "Yesterday",
    team: "kestrel",
    players: ["kestrel"],
  },
  {
    cup: "Weekly Rush Cup",
    when: "Last Sunday",
    team: "Team Cobalt",
    players: ["ferro", "ash", "juno"],
  },
];

const FILTERS: { value: ModeKey | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "rush", label: "Rush" },
  { value: "aim1", label: "1v1 Aim" },
  { value: "aim2", label: "2v2 Aim" },
];

// Seconds until 20:00 from when the page opened, so the hero countdown moves
function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CupsTab({ verified }: { verified: boolean }) {
  const [filter, setFilter] = useState<ModeKey | "all">("all");
  const countdown = useCountdown(1 * 3600 + 12 * 60 + 4);
  const hero = CUPS[1]!;
  const list = CUPS.filter((c) => c.id !== hero.id && (filter === "all" || c.mode === filter));
  const live = CUPS.find((c) => c.status === "live");

  return (
    <div className={styles.stack}>
      {/* Next cup, big */}
      <section className={styles.hero} aria-labelledby="next-cup">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hero.art} alt="" className={styles.heroArt} />
        <span className={styles.heroShade} />
        <div className={styles.heroBody}>
          <span className={styles.kicker}>Next cup · {hero.kind}</span>
          <h2 id="next-cup" className={styles.heroName}>
            {hero.name}
          </h2>
          <ul className={styles.facts}>
            <li>{MODE_NAME[hero.mode]}</li>
            <li>Single elimination</li>
            <li>Bo1, Bo3 final</li>
            <li>
              <span className="mono">
                {hero.entries} / {hero.cap}
              </span>{" "}
              teams
            </li>
          </ul>
          <div className={styles.prize}>
            <span className={styles.badge} aria-hidden="true" />
            <span>
              <strong>Prize</strong> Gold cup badge on your profile
            </span>
          </div>
        </div>
        <div className={styles.heroSide}>
          <span className={styles.countLabel}>Starts in</span>
          <span className={cx(styles.count, "mono")}>{countdown}</span>
          {verified ? (
            <button type="button" className={styles.signUp}>
              Sign up party
            </button>
          ) : (
            <>
              <button type="button" className={styles.signUp} disabled>
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                Verified required
              </button>
              <span className={styles.sideNote}>3 more clean matches to unlock cups</span>
            </>
          )}
        </div>
      </section>

      {live && (
        <a className={cx("glass", styles.liveBar)} href="#bracket">
          <span className={styles.liveTag}>
            <span className={styles.liveDot} />
            Live
          </span>
          <span className={styles.liveName}>
            {live.name} <span className="muted">· {MODE_NAME[live.mode]}</span>
          </span>
          <span className={styles.liveStage}>{live.stage}</span>
          <span className={styles.liveLink}>Watch bracket</span>
        </a>
      )}

      <section aria-labelledby="schedule" className={cx("glass", styles.panel)}>
        <div className={styles.panelHead}>
          <h2 id="schedule" className={styles.panelTitle}>
            Schedule
          </h2>
          <div className={styles.filters} role="group" aria-label="Filter by mode">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <ul className={styles.rows}>
          {list.map((c) => {
            const pct = Math.round((c.entries / c.cap) * 100);
            return (
              <li key={c.id} className={styles.row} data-status={c.status}>
                <span className={styles.when}>
                  <span className={styles.day}>{c.day}</span>
                  <span className={cx(styles.time, "mono")}>{c.time}</span>
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.art} alt="" className={styles.thumb} />
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>{c.name}</span>
                  <span className={styles.rowMeta}>
                    {MODE_NAME[c.mode]} · {c.kind}
                  </span>
                </span>
                <span className={styles.fill}>
                  <span className={cx(styles.fillText, "mono")}>
                    {c.entries} / {c.cap}
                  </span>
                  <span className={styles.bar}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </span>
                <span className={styles.rowAction}>
                  {c.status === "live" ? (
                    <span className={styles.stateLive}>{c.stage}</span>
                  ) : c.status === "full" ? (
                    <span className={styles.stateFull}>Full</span>
                  ) : verified ? (
                    <button type="button" className={styles.rowBtn}>
                      Sign up
                    </button>
                  ) : (
                    <span className={styles.stateLocked}>Verified only</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="winners" className={cx("glass", styles.panel)}>
        <div className={styles.panelHead}>
          <h2 id="winners" className={styles.panelTitle}>
            Recent winners
          </h2>
        </div>
        <ul className={styles.winners}>
          {WINNERS.map((w) => (
            <li key={w.cup + w.when}>
              <span className={styles.badge} aria-hidden="true" />
              <span className={styles.winText}>
                <strong>{w.team}</strong>
                <span className="muted">
                  {w.cup} · {w.when}
                </span>
              </span>
              <span className={styles.avatars}>
                {w.players.map((p) => (
                  <Avatar key={p} name={p} size="sm" />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
