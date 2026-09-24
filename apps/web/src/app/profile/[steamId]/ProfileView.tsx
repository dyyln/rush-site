"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { RANKED_MODES as MODES, isRushMode, type Mode } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { ChallengeButton } from "@/components/challenges/ChallengeButton";
import { FriendButton } from "@/components/friends/FriendButton";
import { RatingChart } from "@/components/ui/RatingChart";
import { ProfileNudge } from "@/components/profile/ProfileNudge";
import { BestMaps } from "@/components/profile/BestMaps";
import { CupBadges } from "@/components/profile/CupBadges";
import { BadgeEmblem, cadenceFromName } from "@/components/profile/BadgeEmblem";
import { FormDots } from "@/components/ui/FormDots";
import { PageTabs, type PageTab } from "@/components/ui/PageTabs";
import { RatingText } from "@/components/ui/RatingText";
import { TierChip } from "@/components/ui/TierChip";
import { api, ApiError } from "@/lib/api";
import { formatStat, winRate } from "@/lib/format";
import { MODE_ART, MODE_COPY, modeLabel } from "@/lib/modes";
import { useBackdrop } from "@/lib/useBackdrop";
import type { FavouriteWeapon, MatchSummary, ModeStats, Profile, Streak, BadgeKind, CupCadence, ProfileBadge } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { useSession } from "@/lib/session";
import { MyReports } from "@/components/review/MyReports";
import { WeaponIcon, weaponLabel } from "@/components/icons";
import { ProfileSkeleton } from "@/components/skeletons/ProfileSkeleton";
import { MatchHistory } from "./MatchHistory";
import styles from "./profile.module.css";

export function ProfileView({ steamId }: { steamId: string }) {
  const data = useAsync(() => api.profile(steamId), [steamId]);

  if (data.status === "loading") return <ProfileSkeleton />;
  if (data.status === "error") {
    const notFound = data.error instanceof ApiError && data.error.status === 404;
    return (
      <div className="container page">
        <Card title={notFound ? "Player not found" : "Could not load profile"}>
          <p className="muted">{notFound ? "No player has that Steam ID here." : "Try again in a moment."}</p>
          {!notFound && (
            <div className={styles.retry}>
              <Button variant="secondary" onClick={data.reload}>
                Retry
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }
  return <ProfileBody profile={data.data} />;
}

type ProfileTab = "overview" | "matches" | "cups" | "reports";

function ProfileBody({ profile }: { profile: Profile }) {
  const best = [...profile.modes].sort((a, b) => b.rating - a.rating)[0]?.mode ?? "rush3v3";
  const [mode, setMode] = useState<Mode>(best);
  const stats = profile.modes.find((m) => m.mode === mode);
  const { user: viewer } = useSession();
  const own = !!viewer && viewer.steamId === profile.user.steamId;
  useBackdrop(mode);

  const params = useSearchParams();
  const tabs: PageTab[] = [
    { key: "overview", label: "Overview", href: "?" },
    { key: "matches", label: "Matches", href: "?tab=matches" },
    { key: "cups", label: "Cups", href: "?tab=cups", count: profile.badges.length },
    ...(own ? [{ key: "reports", label: "Reports", href: "?tab=reports" }] : []),
  ];
  const raw = params.get("tab");
  const tab = (tabs.some((t) => t.key === raw) ? raw : "overview") as ProfileTab;

  return (
    <div className={cx("container", styles.page)}>
      <header className={styles.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.heroArt} src={profile.backgroundUrl ?? MODE_ART[best]} alt="" />
        <div className={styles.heroShade} />
        <div className={styles.heroMain}>
          <Avatar name={profile.user.displayName} src={profile.user.avatarUrl} size="lg" />
          <div className={styles.heroText}>
            <div className={styles.nameRow}>
              <h1 className={styles.name}>{profile.user.displayName}</h1>
              <a
                className={styles.steam}
                href={`https://steamcommunity.com/profiles/${profile.user.steamId}`}
                target="_blank"
                rel="noreferrer"
                title="Steam profile"
              >
                <SteamLogo />
                <span className="visually-hidden">{profile.user.displayName} on Steam (opens in a new tab)</span>
              </a>
            </div>
            {!own && (
              <div className={styles.heroActions}>
                <FriendButton target={profile.user} iconClassName={styles.iconAction} />
                <ChallengeButton
                  target={profile.user}
                  trigger={(open) => (
                    <button type="button" className={styles.iconAction} onClick={open} aria-haspopup="dialog" title={`Challenge ${profile.user.displayName}`}>
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 3l9.5 9.5M17 3l-9.5 9.5" />
                        <path d="M10.5 14.5l2 2M14.5 10.5l2 2M15.5 15.5l2 2" />
                        <path d="M9.5 14.5l-2 2M5.5 10.5l-2 2M4.5 15.5l-2 2" />
                      </svg>
                      <span className="visually-hidden">Challenge {profile.user.displayName}</span>
                    </button>
                  )}
                />
              </div>
            )}
          </div>
          {profile.badges.length > 0 && (
            <div className={styles.heroSide}>
              <TrophyShelf badges={profile.badges} />
            </div>
          )}
        </div>
        <PageTabs label="Profile" items={tabs} current={tab} className={styles.heroTabs} />
      </header>

      {own && <ProfileNudge trust={viewer?.trust} enabled variant="line" />}

      {tab === "overview" && (
        <>
          <section aria-labelledby="ratings-heading">
            <h2 id="ratings-heading" className="visually-hidden">
              Ratings
            </h2>
            <ul className={styles.ratings}>
              {[...MODES]
                .sort((a, b) => Number(isRushMode(b)) - Number(isRushMode(a)))
                .map((m) => (
                  <li key={m}>
                    <RatingCard mode={m} stats={profile.modes.find((x) => x.mode === m)} active={m === mode} onSelect={() => setMode(m)} />
                  </li>
                ))}
            </ul>
          </section>
          <section aria-labelledby="mode-heading" className="stack">
            <h2 id="mode-heading" className="visually-hidden">
              {modeLabel(mode)}
            </h2>
            {stats ? (
              <ModeDetail stats={stats} recent={profile.recentMatches.filter((m) => m.mode === mode)} weapon={profile.favouriteWeapon ?? null} />
            ) : (
              <p className={cx("glass", styles.empty)}>No matches in {modeLabel(mode)} yet.</p>
            )}
          </section>
        </>
      )}

      {tab === "matches" && <MatchHistory steamId={profile.user.steamId} first={profile.recentMatches} firstCursor={profile.recentMatchesCursor ?? null} />}

      {tab === "cups" && (
        <section aria-labelledby="badges-heading" className="stack">
          <h2 id="badges-heading" className={styles.sectionTitle}>
            Cup badges
          </h2>
          {profile.badges.length > 0 ? (
            <CupBadges badges={profile.badges} />
          ) : (
            <p className={cx("glass", styles.empty)}>
              No cup placings yet. <Link href="/tournaments">See the next cups</Link>
            </p>
          )}
        </section>
      )}

      {tab === "reports" && own && <MyReports />}
    </div>
  );
}

// One tile per mode, the mode's art behind it. Picking one shows that mode below
function RatingCard({ mode, stats, active, onSelect }: { mode: Mode; stats?: ModeStats; active: boolean; onSelect: () => void }) {
  const played = !!stats && stats.matches > 0;
  return (
    <button type="button" className={cx(styles.ratingCard, active && styles.active)} onClick={onSelect} aria-pressed={active}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.ratingArt} src={MODE_ART[mode]} alt="" />
      <span className={styles.ratingShade} />
      <span className={styles.ratingTop}>
        <span className={styles.ratingMode}>{MODE_COPY[mode].label}</span>
        <span className={styles.ratingSub}>{played ? (stats.leaderboardRank ? `#${stats.leaderboardRank}` : "Unplaced") : "No matches"}</span>
      </span>
      <span className={styles.ratingValue}>
        {played ? <TierChip tier={stats.tier} rating={stats.rating} rank={stats.leaderboardRank} /> : <TierChip unranked />}
      </span>
      {played && stats.streak ? <StreakLine streak={stats.streak} /> : <span className={styles.streak}>{" "}</span>}
      {stats && (
        <span className={styles.ratingSpark}>
          <RatingChart points={stats.history} label={`${MODE_COPY[mode].label} rating trend`} compact />
        </span>
      )}
    </button>
  );
}

function ModeDetail({ stats, recent, weapon }: { stats: ModeStats; recent: MatchSummary[]; weapon: FavouriteWeapon | null }) {
  // Last five results in this mode, oldest on the left
  const recentForm = recent.slice(0, 5).reverse();
  return (
    <div className="stack">
      {/* Straight on the page, so every line is full-strength text */}
      <dl className={styles.statRow}>
        <Stat label="Rating" value={<RatingText value={stats.rating} fallback={<TierChip tier={stats.tier} link={false} />} />} />
        <Stat label="Matches" value={stats.matches} />
        <Stat
          label="Win rate"
          value={
            <>
              {formatStat(winRate(stats.wins, stats.matches), "pct", stats.matches)}
              <span className={styles.wl}>
                <span className={styles.w}>{stats.wins}W</span> <span className={styles.l}>{stats.losses}L</span>
              </span>
            </>
          }
        />
        <Stat label="Headshot" value={formatStat(stats.headshotPct, "pct", stats.matches)} />
        <Stat label="K/D" value={formatStat(stats.kd, "kd", stats.matches)} />
        <Stat
          label="Form"
          value={recentForm.length > 0 ? <FormDots results={recentForm.map((m) => ({ id: m.matchId, result: m.result }))} className={styles.formDots} /> : "--"}
        />
        {weapon && (
          <Stat
            label="Favourite"
            value={
              <span className={styles.favourite}>
                <WeaponIcon name={weapon.weapon} size={28} className={styles.favouriteIcon} />
                {weaponLabel(weapon.weapon)}
                <span className={styles.favouriteKills}>{weapon.kills} kills</span>
              </span>
            }
          />
        )}
      </dl>
      <div className="grid-2">
        <Card title="Rating history">
          <RatingChart key={stats.mode} points={stats.history} label={`${MODE_COPY[stats.mode].label} rating history`} />
        </Card>
        <Card title="Best maps">
          <BestMaps mode={stats.mode} maps={stats.bestMaps} />
        </Card>
      </div>
    </div>
  );
}

const PLACING_ORDER: Record<BadgeKind, number> = { cup_champion: 0, cup_runner_up: 1, cup_semifinalist: 2 };
const PLACING_NAME: Record<BadgeKind, [string, string]> = {
  cup_champion: ["cup win", "cup wins"],
  cup_runner_up: ["runner-up", "runner-ups"],
  cup_semifinalist: ["top 4", "top 4s"],
};
const CADENCE_ORDER: Record<CupCadence, number> = { special: 0, weekly: 1, daily: 2 };
const SHELF_MAX = 6;

// The best cup placings on the hero, one trophy per placing and cup kind with a count.
// Links to the full list on the Cups tab
function TrophyShelf({ badges }: { badges: ProfileBadge[] }) {
  const groups = new Map<string, { kind: BadgeKind; cadence: CupCadence; n: number }>();
  for (const b of badges) {
    const cadence = cadenceFromName(b.tournamentName);
    const key = `${b.kind}:${cadence}`;
    const g = groups.get(key);
    if (g) g.n += 1;
    else groups.set(key, { kind: b.kind, cadence, n: 1 });
  }
  const shelf = [...groups.values()]
    .sort((a, b) => PLACING_ORDER[a.kind] - PLACING_ORDER[b.kind] || CADENCE_ORDER[a.cadence] - CADENCE_ORDER[b.cadence])
    .slice(0, SHELF_MAX);
  const counts = (Object.keys(PLACING_ORDER) as BadgeKind[])
    .map((k) => [k, badges.filter((b) => b.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${PLACING_NAME[k][n === 1 ? 0 : 1]}`);
  return (
    <Link href="?tab=cups" scroll={false} replace className={styles.shelf}>
      <span className={styles.shelfTrophies} aria-hidden="true">
        {shelf.map((g) => (
          <span key={`${g.kind}:${g.cadence}`} className={styles.shelfItem}>
            <BadgeEmblem kind={g.kind} cadence={g.cadence} size={56} />
            {g.n > 1 && <span className={cx(styles.shelfCount, "mono")}>×{g.n}</span>}
          </span>
        ))}
      </span>
      <span className={styles.shelfText}>{counts.join(" · ")}</span>
      <span className="visually-hidden">, see all cup placings</span>
    </Link>
  );
}

function SteamLogo() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"
      />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd className={cx(styles.statValue, "mono")}>{value}</dd>
    </div>
  );
}

function StreakLine({ streak }: { streak: Streak }) {
  const now = streak.current > 0 ? `W${streak.current}` : streak.current < 0 ? `L${-streak.current}` : "None";
  return (
    <span className={styles.streak}>
      <span>
        Streak{" "}
        <span className="mono" data-sign={streak.current > 0 ? "up" : streak.current < 0 ? "down" : "none"}>
          {now}
        </span>
      </span>
      <span>
        Best <span className="mono">W{streak.longest}</span>
      </span>
    </span>
  );
}
