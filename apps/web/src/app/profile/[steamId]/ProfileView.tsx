"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { RANKED_MODES as MODES, isRushMode, type Mode } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { ChallengeButton } from "@/components/challenges/ChallengeButton";
import { FriendButton } from "@/components/friends/FriendButton";
import { RatingChart } from "@/components/ui/RatingChart";
import { ProfileNudge } from "@/components/profile/ProfileNudge";
import { BestMaps } from "@/components/profile/BestMaps";
import { CupBadges } from "@/components/profile/CupBadges";
import { FormDots } from "@/components/ui/FormDots";
import { StatTile } from "@/components/ui/StatTile";
import { PageTabs, type PageTab } from "@/components/ui/PageTabs";
import { RatingText } from "@/components/ui/RatingText";
import { TierChip } from "@/components/ui/TierChip";
import { api, ApiError } from "@/lib/api";
import { formatStat, signed, winRate } from "@/lib/format";
import { MODE_ART, MODE_COPY, modeLabel } from "@/lib/modes";
import { useBackdrop } from "@/lib/useBackdrop";
import type { FavouriteWeapon, MatchSummary, ModeStats, Profile, Streak, TrustLevel } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { useSession } from "@/lib/session";
import { TrustChip } from "@/components/trust/TrustChip";
import { MyReports } from "@/components/review/MyReports";
import { WeaponIcon, weaponLabel } from "@/components/icons";
import { ProfileSkeleton } from "@/components/skeletons/ProfileSkeleton";
import { MatchHistory } from "./MatchHistory";
import styles from "./profile.module.css";

const TRUST: Record<TrustLevel, { label: string; tone: BadgeTone }> = {
  new: { label: "New", tone: "neutral" },
  verified: { label: "Verified", tone: "info" },
  trusted: { label: "Trusted", tone: "win" },
};

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
  const trust = TRUST[profile.user.trustLevel];
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
        <img className={styles.heroArt} src={MODE_ART[best]} alt="" />
        <div className={styles.heroShade} />
        <div className={styles.heroMain}>
          <Avatar name={profile.user.displayName} src={profile.user.avatarUrl} size="lg" />
          <div className={styles.heroText}>
            <h1 className={styles.name}>{profile.user.displayName}</h1>
            <div className={styles.chips}>
              {viewer?.trust && own ? <TrustChip trust={viewer.trust} /> : <Badge tone={trust.tone}>{trust.label}</Badge>}
              <Badge>{profile.user.region.toUpperCase()}</Badge>
              <a className={styles.steam} href={`https://steamcommunity.com/profiles/${profile.user.steamId}`} target="_blank" rel="noreferrer">
                Steam profile
              </a>
            </div>
            {(profile.recentMatches.length > 0 || profile.favouriteWeapon) && (
              <div className={styles.heroMeta}>
                {profile.recentMatches.length > 0 && <RecentForm matches={profile.recentMatches} />}
                {profile.favouriteWeapon && <Favourite weapon={profile.favouriteWeapon} />}
              </div>
            )}
          </div>
          {!own && (
            <div className={styles.heroActions}>
              <FriendButton target={profile.user} />
              <ChallengeButton target={profile.user} />
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
            {stats ? <ModeDetail stats={stats} /> : <p className={cx("glass", styles.empty)}>No matches in {modeLabel(mode)} yet.</p>}
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

function ModeDetail({ stats }: { stats: ModeStats }) {
  const last = stats.history.at(-1)?.rating ?? stats.rating;
  const first = stats.history[0]?.rating ?? stats.rating;
  const delta = last - first;
  return (
    <div className="stack">
      <div className={styles.tiles}>
        <StatTile
          label="Rating"
          value={<RatingText value={stats.rating} fallback={<TierChip tier={stats.tier} link={false} />} />}
          sub={`${signed(delta)} over ${stats.history.length} matches`}
          trend={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}
        />
        <StatTile label="Win rate" value={formatStat(winRate(stats.wins, stats.matches), "pct", stats.matches)} sub={`${stats.wins}W ${stats.losses}L`} />
        <StatTile label="Headshot" value={formatStat(stats.headshotPct, "pct", stats.matches)} />
        <StatTile label="K/D" value={formatStat(stats.kd, "kd", stats.matches)} sub={`${stats.matches} matches`} />
      </div>
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

// Last five results, oldest on the left
function RecentForm({ matches }: { matches: MatchSummary[] }) {
  const last = matches.slice(0, 5).reverse();
  return (
    <span className={styles.form}>
      <span className="eyebrow">Form</span>
      <FormDots results={last.map((m) => ({ id: m.matchId, result: m.result }))} />
    </span>
  );
}

function Favourite({ weapon }: { weapon: FavouriteWeapon }) {
  const name = weaponLabel(weapon.weapon);
  return (
    <span className={styles.favourite}>
      <span className="eyebrow">Favourite</span>
      <WeaponIcon name={weapon.weapon} size={20} className={styles.favouriteIcon} />
      <span>{name}</span>
      <span className="muted mono">{weapon.kills} kills</span>
    </span>
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
