"use client";

import { useEffect, useState } from "react";
import type { Mode } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { TierChip } from "@/components/ui/TierChip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FormDots } from "@/components/ui/FormDots";
import { PartySize } from "@/components/ui/PartySize";
import { useBackdrop } from "@/lib/useBackdrop";
import { cx } from "@/components/ui/cx";
import styles from "./play-mockup.module.css";

// Mockup only. Everything below is fake data held in local state

type Tab = "ranked" | "cups" | "test";
type Tile = {
  mode: Mode;
  name: string;
  format: string;
  size: number;
  art: string;
  blurb: string;
  queue: number;
  live: number;
  tier?: { tier: "gold" | "silver"; rating: number; rank?: number };
};

const RANKED: Tile[] = [
  { mode: "rush3v3", name: "Rush", format: "3v3", size: 3, art: "/backdrops/rush_001_1.webp", blurb: "Valve's Rush on Complex", queue: 43, live: 13, tier: { tier: "gold", rating: 1712, rank: 214 } },
  { mode: "aim1v1", name: "Aim", format: "1v1", size: 1, art: "/maps/aim_redline.webp", blurb: "Duel 1v1 in aim maps", queue: 18, live: 9, tier: { tier: "silver", rating: 1455 } },
  { mode: "aim2v2", name: "Aim", format: "2v2", size: 2, art: "/maps/aim_deagle7k.webp", blurb: "Partner up in aim maps", queue: 11, live: 4 },
];
const TEST: Tile[] = [
  { mode: "rush1v1", name: "Rush Test", format: "1v1", size: 1, art: "/rush-rooms/205.webp", blurb: "Unrated test queue for Rush with two players", queue: 2, live: 1 },
];
const CUPS = [
  { name: "Daily Rush Cup", when: "Starts 20:00", entries: "22 / 32", art: "/backdrops/rush_001_2.webp" },
  { name: "Daily Aim Cup 2v2", when: "Starts 21:00", entries: "9 / 16", art: "/maps/aim_usp.webp" },
  { name: "Weekly Rush Cup", when: "Sunday 18:00", entries: "41 / 64", art: "/backdrops/rush_001_4.webp" },
];
const PARTY = [
  { name: "meridius", leader: true },
  { name: "Mira", leader: false },
];
const FRIENDS = [
  { name: "Kestrel", status: "In queue · Rush", tone: "ready" as const },
  { name: "Juno", status: "Online", tone: "online" as const },
  { name: "Tomas", status: "In match · 7 : 4", tone: "away" as const },
  { name: "Ren", status: "Online", tone: "online" as const },
];
const OFFLINE = ["Aster", "Bo", "Quill"];
const TRUST = [
  { value: "new", label: "Any" },
  { value: "verified", label: "Verified" },
  { value: "trusted", label: "Trusted" },
] as const;

export function PlayMockup() {
  const [tab, setTab] = useState<Tab>("ranked");
  const [selected, setSelected] = useState<Mode[]>(["rush3v3"]);
  const [trust, setTrust] = useState<(typeof TRUST)[number]["value"]>("new");
  const [queuedAt, setQueuedAt] = useState<number | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rail, setRail] = useState<"friends" | "chat">("friends");
  const now = useTicker(queuedAt !== null);
  useBackdrop(selected);

  const queued = queuedAt !== null;
  const tiles = tab === "test" ? TEST : RANKED;
  const toggle = (m: Mode) => !queued && setSelected((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  const names = [...RANKED, ...TEST].filter((t) => selected.includes(t.mode) && t.size >= PARTY.length).map((t) => `${t.format} ${t.name}`);
  const elapsed = queuedAt ? Math.floor((now - queuedAt) / 1000) : 0;

  return (
    <div className={styles.page}>
      <div className={cx("container", styles.wrap)}>
        <p className={styles.mockNote}>Mockup. Fake data, nothing here queues.</p>

        {/* 5. Tabs replace the title band. 3. Party slots sit on the right of the same row */}
        <div className={styles.topRow}>
          <nav className={styles.tabs} aria-label="Play">
            {(["ranked", "cups", "test"] as const).map((t) => (
              <button key={t} type="button" className={styles.tab} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
                {t === "ranked" ? "Ranked" : t === "cups" ? "Cups" : "Test"}
              </button>
            ))}
          </nav>

          <div className={styles.party} aria-label="Party">
            {PARTY.map((p) => (
              <span key={p.name} className={styles.slot} title={p.leader ? `${p.name}, leader` : p.name}>
                <Avatar name={p.name} size="lg" status="online" />
                {p.leader && <span className={styles.crown} aria-label="Leader" />}
              </span>
            ))}
            <span className={styles.inviteWrap}>
              <button type="button" className={cx(styles.slot, styles.slotEmpty)} aria-label="Invite to party" aria-expanded={inviteOpen} onClick={() => setInviteOpen((o) => !o)}>
                +
              </button>
              {inviteOpen && (
                <span className={styles.popover} role="dialog" aria-label="Invite">
                  <strong className={styles.popTitle}>Invite to party</strong>
                  <span className={cx(styles.link, "mono")}>rushsite.gg/invite/k3v9-q2</span>
                  <span className={styles.popRow}>
                    <button type="button" className={styles.smallBtn}>Copy link</button>
                    <button type="button" className={styles.smallBtnGhost}>New link</button>
                  </span>
                  <span className="muted">Or pick a friend from the list on the right.</span>
                </span>
              )}
            </span>
          </div>
        </div>

        <div className={styles.main}>
          <div className={styles.center}>
            {/* 6. Get Verified shrinks to one line */}
            <p className={cx("glass", styles.notice)}>
              <span className={styles.noticeTag}>Get Verified</span>
              <span>Play 3 more clean matches to enter cups.</span>
              <span className={styles.progress} aria-label="2 of 5">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} data-on={i < 2 || undefined} />
                ))}
              </span>
            </p>

            {tab === "cups" ? (
              <ul className={styles.tiles}>
                {CUPS.map((c) => (
                  <li key={c.name}>
                    <div className={styles.tile}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.art} alt="" className={styles.art} />
                      <span className={styles.shade} />
                      <span className={styles.tileTop}>
                        <span className={styles.chip}>{c.when}</span>
                      </span>
                      <span className={styles.tileBottom}>
                        <span className={styles.tileName}>{c.name}</span>
                        <span className={cx(styles.tileMeta, "mono")}>{c.entries} signed up</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              /* 2. Big picture tiles. 7. Queue counts on the art */
              <ul className={styles.tiles}>
                {tiles.map((t) => {
                  const tooBig = t.size < PARTY.length;
                  const on = selected.includes(t.mode) && !tooBig;
                  return (
                    <li key={t.mode}>
                      <label className={cx(styles.tile, on && styles.on, (queued || tooBig) && styles.locked, tooBig && styles.off)}>
                        <input type="checkbox" className="visually-hidden" checked={on} disabled={queued || tooBig} onChange={() => toggle(t.mode)} />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={t.art} alt="" className={styles.art} />
                        <span className={styles.shade} />
                        <span className={styles.tileTop}>
                          <span className={cx(styles.chip, tooBig && styles.chipOver)}>
                            <PartySize
                              count={Math.min(PARTY.length, t.size)}
                              capacity={t.size}
                              overflow={Math.max(0, PARTY.length - t.size)}
                              label={tooBig ? `Party too big for ${t.format}` : t.format}
                            />
                            <span className={styles.format}>{t.format}</span>
                          </span>
                          <span className={styles.tick} aria-hidden="true">
                            {tooBig ? (
                              <svg viewBox="0 0 16 16" width="16" height="16">
                                <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
                                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                              </svg>
                            ) : queued && on ? (
                              <span className={styles.spin} />
                            ) : (
                              <svg viewBox="0 0 16 16" width="16" height="16">
                                <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                        </span>
                        <span className={styles.tileBottom}>
                          {tooBig && (
                            <span className={styles.reason}>
                              Party of {PARTY.length} · max {t.size}
                            </span>
                          )}
                          <span className={styles.tileName}>{t.name}</span>
                          <span className={styles.tileBlurb}>{t.blurb}</span>
                          <span className={styles.tileFoot}>
                            {t.tier ? (
                              <span className={styles.standing}>
                                <TierChip tier={t.tier.tier} rating={t.tier.rating} size="sm" link={false} />
                                {t.tier.rank && <span className="mono">#{t.tier.rank}</span>}
                              </span>
                            ) : t.mode === "rush1v1" ? (
                              <span className={styles.standing}>Unrated</span>
                            ) : (
                              <TierChip unranked size="sm" link={false} />
                            )}
                            <span className={cx(styles.tileMeta, "mono")}>
                              <span className={styles.liveDot} />
                              {t.queue} searching · {t.live} live
                            </span>
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 6. Stats become a slim strip */}
            <dl className={cx("glass", styles.stats)}>
              <div>
                <dt>Win rate</dt>
                <dd className="mono">58%</dd>
              </div>
              <div>
                <dt>Headshot</dt>
                <dd className="mono">41%</dd>
              </div>
              <div>
                <dt>K/D</dt>
                <dd className="mono">1.18</dd>
              </div>
              <div>
                <dt>Matches</dt>
                <dd className="mono">86</dd>
              </div>
              <div>
                <dt>Last 5</dt>
                <dd>
                  <FormDots
                    label="Last 5"
                    results={[
                      { id: "1", result: "win" },
                      { id: "2", result: "win" },
                      { id: "3", result: "loss" },
                      { id: "4", result: "win" },
                      { id: "5", result: "loss" },
                    ]}
                  />
                </dd>
              </div>
            </dl>
          </div>

          {/* 4. Friends and chat share one right rail */}
          <aside className={cx("glass", styles.rail)} aria-label="Friends and chat">
            <div className={styles.railTabs} role="tablist">
              <button type="button" role="tab" aria-selected={rail === "friends"} onClick={() => setRail("friends")}>
                Friends <span className="mono muted">4</span>
              </button>
              <button type="button" role="tab" aria-selected={rail === "chat"} onClick={() => setRail("chat")}>
                Chat
              </button>
            </div>
            {rail === "friends" ? (
              <ul className={styles.friends}>
                {FRIENDS.map((f) => (
                  <li key={f.name}>
                    <Avatar name={f.name} size="sm" status={f.tone} />
                    <span className={styles.friendText}>
                      <span>{f.name}</span>
                      <span className={styles.friendStatus}>{f.status}</span>
                    </span>
                    <button type="button" className={styles.smallBtnGhost} aria-label={`Invite ${f.name}`}>
                      Invite
                    </button>
                  </li>
                ))}
                <li className={styles.offlineHead}>Offline {OFFLINE.length}</li>
                {OFFLINE.map((n) => (
                  <li key={n} className={styles.offline}>
                    <Avatar name={n} size="sm" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.chat}>
                <p>
                  <strong>Kestrel</strong> anyone for rush?
                </p>
                <p>
                  <strong>Juno</strong> in 5
                </p>
                <p className="muted">The chat sidebar would move in here.</p>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* 1. Docked action bar with GO on the right */}
      <div className={styles.dock}>
        <div className={cx("container", styles.dockInner)}>
          <div className={styles.dockLeft}>
            <span className={styles.dockModes}>
              <span className={styles.dockLabel}>{queued ? "Searching" : "Selected"}</span>
              <span className={styles.dockValue}>{names.length ? names.join(" + ") : "Pick a mode"}</span>
            </span>
            <SegmentedControl label="Opponents" value={trust} onChange={setTrust} disabled={queued} options={TRUST.map((o) => ({ ...o, disabled: o.value === "trusted" }))} />
          </div>
          {queued ? (
            <div className={styles.searching}>
              <span className={styles.timer}>
                <span className={cx(styles.timerValue, "mono")}>{fmt(elapsed)}</span>
                <span className={styles.timerSub}>Est. 1:30 · 43 searching</span>
              </span>
              <button type="button" className={styles.cancel} onClick={() => setQueuedAt(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className={styles.go} disabled={names.length === 0} onClick={() => setQueuedAt(Date.now())}>
              Go
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useTicker(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
