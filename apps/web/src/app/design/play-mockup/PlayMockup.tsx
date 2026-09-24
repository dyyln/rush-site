"use client";

import { useEffect, useRef, useState } from "react";
import type { Mode } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { TierChip } from "@/components/ui/TierChip";
import { FormDots } from "@/components/ui/FormDots";
import { PartySize } from "@/components/ui/PartySize";
import { Logo } from "@/components/ui/Logo";
import { BRAND_NAME } from "@rushsite/shared";
import Link from "next/link";
import { useBackdrop } from "@/lib/useBackdrop";
import { cx } from "@/components/ui/cx";
import { CupsTab } from "./CupsTab";
import { LeaderboardTab } from "./LeaderboardTab";
import styles from "./play-mockup.module.css";

// Mockup only. Everything below is fake data held in local state

type Tab = "ranked" | "cups" | "leaderboard" | "test";
const TAB_NAMES: Record<Tab, string> = {
  ranked: "Ranked",
  cups: "Cups",
  leaderboard: "Leaderboard",
  test: "Test",
};
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
  {
    mode: "rush3v3",
    name: "Rush",
    format: "3v3",
    size: 3,
    art: "/backdrops/rush_001_1.webp",
    blurb: "Rush",
    queue: 43,
    live: 13,
    tier: { tier: "gold", rating: 1712, rank: 214 },
  },
  {
    mode: "aim1v1",
    name: "Aim",
    format: "1v1",
    size: 1,
    art: "/maps/aim_redline.webp",
    blurb: "Duel 1v1 in aim maps",
    queue: 18,
    live: 9,
    tier: { tier: "silver", rating: 1455 },
  },
  {
    mode: "aim2v2",
    name: "Aim",
    format: "2v2",
    size: 2,
    art: "/maps/aim_deagle7k.webp",
    blurb: "Partner up in aim maps",
    queue: 11,
    live: 4,
  },
];
const TEST: Tile[] = [
  {
    mode: "rush1v1",
    name: "Rush Test",
    format: "1v1",
    size: 1,
    art: "/rush-rooms/205.webp",
    blurb: "Unrated test queue for Rush with two players",
    queue: 2,
    live: 1,
  },
  {
    mode: "rush2v2",
    name: "Rush Test",
    format: "2v2",
    size: 2,
    art: "/rush-rooms/203.webp",
    blurb: "Unrated test queue for Rush with four players",
    queue: 3,
    live: 1,
  },
];
const ME = "meridius";
const MAX_PARTY = 3;
type Member = { name: string };
const START_PARTY: Member[] = [{ name: ME }, { name: "Mira" }];
const FRIENDS = [
  { name: "Kestrel", status: "In queue · Rush", tone: "ready" as const },
  { name: "Juno", status: "Online", tone: "online" as const },
  { name: "Tomas", status: "In match · 7 : 4", tone: "away" as const },
  { name: "Ren", status: "Online", tone: "online" as const },
];
const OFFLINE = ["Aster", "Bo", "Quill"];
type ChatLine = {
  time?: string;
  name?: string;
  text: string;
  party?: boolean;
  system?: boolean;
};
const CHAT: Record<"party" | "global", ChatLine[]> = {
  party: [
    { system: true, text: "Mira joined the party" },
    { time: "16:24", name: "Mira", text: "rush or aim first?", party: true },
    { time: "16:25", name: "meridius", text: "rush, need 1 more", party: true },
    { time: "16:25", name: "Mira", text: "inviting kestrel", party: true },
    { system: true, text: "meridius changed modes to 3v3 Rush" },
  ],
  global: [
    { time: "16:26", name: "kestrel", text: "anyone for rush" },
    { time: "16:27", name: "vanta", text: "gg that last round was close" },
    { time: "16:29", name: "oxbow", text: "aim_redline is so good" },
    { time: "16:31", name: "kestrel", text: "queue times fine tonight" },
    { time: "16:32", name: "vanta", text: "2v2 duo? need one" },
  ],
};

export function PlayMockup() {
  const [tab, setTab] = useState<Tab>("ranked");
  const [selected, setSelected] = useState<Mode[]>(["rush3v3"]);
  const [queuedAt, setQueuedAt] = useState<number | null>(null);
  const [party, setParty] = useState<Member[]>(START_PARTY);
  const [leader, setLeader] = useState(ME);
  // Which party popover is open: "invite" or a member's name
  const [menu, setMenu] = useState<string | null>(null);
  const partyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const click = (e: MouseEvent) => !partyRef.current?.contains(e.target as Node) && setMenu(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const PARTY = party;
  const iLead = leader === ME;
  // Others first, you always on the far right
  const ordered = [...party.filter((m) => m.name !== ME), ...party.filter((m) => m.name === ME)];
  const kick = (name: string) => {
    setParty((p) => p.filter((m) => m.name !== name));
    setMenu(null);
  };
  const promote = (name: string) => {
    setLeader(name);
    setMenu(null);
  };
  const leave = () => {
    setParty([{ name: ME }]);
    setLeader(ME);
    setMenu(null);
  };
  const invite = (name: string) => {
    if (party.length < MAX_PARTY && !party.some((m) => m.name === name)) setParty((p) => [...p, { name }]);
  };
  const [rail, setRail] = useState<"friends" | "chat">("friends");
  const [channel, setChannel] = useState<"party" | "global">("party");
  const now = useTicker(queuedAt !== null);
  useBackdrop(selected);

  const queued = queuedAt !== null;
  const tiles = tab === "test" ? TEST : RANKED;
  const toggle = (m: Mode) => !queued && setSelected((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  const names = [...RANKED, ...TEST].filter((t) => selected.includes(t.mode) && t.size >= PARTY.length).map((t) => `${t.format} ${t.name}`);
  const elapsed = queuedAt ? Math.floor((now - queuedAt) / 1000) : 0;
  // Mock: the queue finds a match after 8 seconds
  const inMatch = queued && elapsed >= 8;

  return (
    <div className={styles.page} data-mockup-play>
      <div className={cx("container", styles.wrap)}>
        <p className={styles.brandLine}>{BRAND_NAME}</p>

        {/* 5. Tabs replace the title band. 3. Party slots sit on the right of the same row */}
        <div className={styles.topRow}>
          {/* The site header is gone. The logo leads the tabs and goes home */}
          <Link href="/" className={styles.logo} title={BRAND_NAME}>
            <Logo size={40} title={`${BRAND_NAME} home`} />
          </Link>
          <nav className={styles.tabs} aria-label="Play">
            {(["ranked", "cups", "leaderboard", "test"] as const).map((t) => (
              <button key={t} type="button" className={styles.tab} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
                {TAB_NAMES[t]}
              </button>
            ))}
          </nav>

          <div ref={partyRef} className={styles.party} aria-label="Party">
            {party.length < MAX_PARTY && (
              <span className={styles.slotWrap}>
                <button
                  type="button"
                  className={cx(styles.slot, styles.slotEmpty)}
                  aria-label="Invite to party"
                  aria-expanded={menu === "invite"}
                  onClick={() => setMenu((m) => (m === "invite" ? null : "invite"))}
                >
                  +
                </button>
                {menu === "invite" && (
                  <span className={styles.popover} role="dialog" aria-label="Invite">
                    <strong className={styles.popTitle}>Invite to party</strong>
                    <span className={cx(styles.link, "mono")}>duelrush.site/invite/k3v9-q2</span>
                    <span className={styles.popRow}>
                      <button type="button" className={styles.smallBtn}>
                        Copy link
                      </button>
                      <button type="button" className={styles.smallBtnGhost}>
                        New link
                      </button>
                    </span>
                    <span className="muted">Or pick a friend from the list on the right.</span>
                  </span>
                )}
              </span>
            )}
            {ordered.map((p) => {
              const me = p.name === ME;
              const isLeader = p.name === leader;
              return (
                <span key={p.name} className={styles.slotWrap}>
                  <button
                    type="button"
                    className={cx(styles.slot, me && styles.slotMe)}
                    aria-label={`${me ? "You" : p.name}${isLeader ? ", leader" : ""}`}
                    aria-expanded={menu === p.name}
                    aria-haspopup="menu"
                    onClick={() => setMenu((m) => (m === p.name ? null : p.name))}
                  >
                    <Avatar name={p.name} size="lg" status="online" />
                    {isLeader && <span className={styles.crown} aria-hidden="true" />}
                  </button>
                  {menu === p.name && (
                    <span className={cx(styles.popover, styles.menu)} role="menu" aria-label={p.name}>
                      <span className={styles.menuHead}>
                        <strong>{p.name}</strong>
                        <span className="muted">{isLeader ? "Party leader" : "Member"}</span>
                      </span>
                      <button type="button" role="menuitem" className={styles.menuItem} onClick={() => setMenu(null)}>
                        View profile
                      </button>
                      {!me && iLead && (
                        <>
                          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => promote(p.name)}>
                            Make leader
                          </button>
                          <button type="button" role="menuitem" className={cx(styles.menuItem, styles.menuDanger)} onClick={() => kick(p.name)}>
                            Kick from party
                          </button>
                        </>
                      )}
                      {me && party.length > 1 && (
                        <button type="button" role="menuitem" className={cx(styles.menuItem, styles.menuDanger)} onClick={leave}>
                          Leave party
                        </button>
                      )}
                      {!me && !iLead && <span className={styles.menuNote}>Only the leader can promote or kick.</span>}
                    </span>
                  )}
                </span>
              );
            })}
            {/* Everything the header's account menu held, behind one button */}
            <span className={cx(styles.slotWrap, styles.menuWrap)}>
              <button
                type="button"
                className={styles.burger}
                aria-label="Menu"
                aria-haspopup="menu"
                aria-expanded={menu === "main"}
                onClick={() => setMenu((m) => (m === "main" ? null : "main"))}
              >
                <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              {menu === "main" && (
                <span className={cx(styles.popover, styles.menu)} role="menu" aria-label="Menu">
                  <span className={styles.menuHead}>
                    <strong>{ME}</strong>
                    <span className="muted">Signed in with Steam</span>
                  </span>
                  {[
                    ["Profile", `/profile`],
                    ["Friends", "/friends"],
                    ["Ranks", "/ranks"],
                    ["Settings", "/settings"],
                    ["Admin", "/admin"],
                  ].map(([label, href]) => (
                    <Link key={label} href={href!} role="menuitem" className={styles.menuItem} onClick={() => setMenu(null)}>
                      {label}
                    </Link>
                  ))}
                  <span className={styles.menuRule} />
                  <button type="button" role="menuitem" className={cx(styles.menuItem, styles.menuDanger)} onClick={() => setMenu(null)}>
                    Sign out
                  </button>
                </span>
              )}
            </span>
          </div>
        </div>

        <div className={styles.main}>
          <div className={styles.center}>
            {/* 6. Get Verified shrinks to one line */}
            {tab !== "leaderboard" && (
              <p className={cx("glass", styles.notice)}>
                <span className={styles.noticeTag}>Get Verified</span>
                <span>Play 3 more clean matches to enter cups.</span>
                <span className={styles.progress} aria-label="2 of 5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} data-on={i < 2 || undefined} />
                  ))}
                </span>
              </p>
            )}

            {tab === "cups" ? (
              <CupsTab verified={false} />
            ) : tab === "leaderboard" ? (
              <LeaderboardTab />
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
                            ) : t.mode === "rush1v1" || t.mode === "rush2v2" ? (
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
            {(tab === "ranked" || tab === "test") && (
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
            )}
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
                    <button type="button" className={styles.smallBtnGhost} aria-label={`Invite ${f.name}`} onClick={() => invite(f.name)}>
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
                <div className={styles.channels} role="tablist" aria-label="Chat channel">
                  {(["party", "global"] as const).map((c) => (
                    <button key={c} type="button" role="tab" aria-selected={channel === c} onClick={() => setChannel(c)}>
                      {c === "party" ? "Party" : "Global"}
                    </button>
                  ))}
                </div>
                <ol className={styles.messages}>
                  {CHAT[channel].map((m, i) =>
                    m.system ? (
                      <li key={i} className={styles.system}>
                        {m.text}
                      </li>
                    ) : (
                      <li key={i} className={styles.message}>
                        <span className={cx(styles.time, "mono")}>{m.time}</span>
                        <span>
                          <span className={styles.author} data-party={m.party || undefined}>
                            {m.name}
                          </span>{" "}
                          {m.text}
                        </span>
                      </li>
                    ),
                  )}
                </ol>
                <form className={styles.compose} onSubmit={(e) => e.preventDefault()}>
                  <input className={styles.input} placeholder={channel === "party" ? "Message your party" : "Message everyone"} aria-label="Message" />
                  <button type="submit" className={styles.send} aria-label="Send">
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="M2 8h10M8 3.5 12.5 8 8 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </form>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* 1. Docked action bar with GO on the right */}
      <div className={styles.dock}>
        <div className={cx("container", styles.dockInner)}>
          <div className={styles.dockLeft}>
            {/* Server status moves here from the footer */}
            <Link href="/status" className={styles.status}>
              <span className={styles.statusDot} />
              All servers up
            </Link>
            <span className={styles.dockModes}>
              <span className={styles.dockLabel}>{inMatch ? "In match" : queued ? "Searching" : "Selected"}</span>
              <span className={styles.dockValue}>
                {inMatch ? (
                  <>
                    3v3 Rush · Round 4 · <span className="mono">2 : 1</span>
                  </>
                ) : names.length ? (
                  names.join(" + ")
                ) : (
                  "Pick a mode"
                )}
              </span>
            </span>
          </div>
          {inMatch ? (
            <span className={styles.searching}>
              <Link href="/matches/steady-violet-lynx" className={styles.goLink}>
                Return to match
              </Link>
              <button type="button" className={styles.cancel} onClick={() => setQueuedAt(null)} title="Mockup only">
                Reset
              </button>
            </span>
          ) : queued ? (
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
