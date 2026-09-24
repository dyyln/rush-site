"use client";

import Link from "next/link";
import { useState } from "react";
import { RANKED_MODES as MODES, type Mode } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { ChallengeButton } from "@/components/challenges/ChallengeButton";
import { FriendButton } from "@/components/friends/FriendButton";
import { RatingChart } from "@/components/ui/RatingChart";
import { ProfileNudge } from "@/components/profile/ProfileNudge";
import { FormDots } from "@/components/ui/FormDots";
import { StatTile } from "@/components/ui/StatTile";
import { Tabs } from "@/components/ui/Tabs";
import { RatingText } from "@/components/ui/RatingText";
import { TierChip } from "@/components/ui/TierChip";
import { api, ApiError } from "@/lib/api";
import { formatStat, pct, shortDate, signed, winRate } from "@/lib/format";
import { MODE_COPY, mapName, modeLabel } from "@/lib/modes";
import type { BadgeKind, FavouriteWeapon, MatchSummary, ModeStats, Profile, Streak, TrustLevel } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { useSession } from "@/lib/session";
import { TrustChip } from "@/components/trust/TrustChip";
import { MyReports } from "@/components/review/MyReports";
import { WeaponIcon, weaponLabel } from "@/components/icons";
import { ProfileSkeleton } from "@/components/skeletons/ProfileSkeleton";
import { MapThumb } from "@/components/play/MapThumb";
import { MatchHistory } from "./MatchHistory";
import styles from "./profile.module.css";

const TRUST: Record<TrustLevel, { label: string; tone: BadgeTone }> = {
  new: { label: "New", tone: "neutral" },
  verified: { label: "Verified", tone: "info" },
  trusted: { label: "Trusted", tone: "win" },
};

const BADGE_LABEL: Record<BadgeKind, string> = {
  cup_champion: "Champion",
  cup_runner_up: "Runner up",
  cup_semifinalist: "Semifinalist",
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

function ProfileBody({ profile }: { profile: Profile }) {
  const best = [...profile.modes].sort((a, b) => b.rating - a.rating)[0]?.mode ?? "rush3v3";
  const [mode, setMode] = useState<Mode>(best);
  const stats = profile.modes.find((m) => m.mode === mode);
  const { user: viewer } = useSession();
  const trust = TRUST[profile.user.trustLevel];
  const own = !!viewer && viewer.steamId === profile.user.steamId;

  return (
    <div className="container page">
      <header className={cx(styles.hero, "title-band")}>
        <Avatar name={profile.user.displayName} src={profile.user.avatarUrl} size="lg" />
        <div className={styles.heroText}>
          <h1>{profile.user.displayName}</h1>
          <div className="row">
            {viewer?.trust && viewer.steamId === profile.user.steamId ? (
              <TrustChip trust={viewer.trust} />
            ) : (
              <Badge tone={trust.tone}>{trust.label}</Badge>
            )}
            <Badge>{profile.user.region.toUpperCase()}</Badge>
            <a className={styles.steam} href={`https://steamcommunity.com/profiles/${profile.user.steamId}`} target="_blank" rel="noreferrer">
              Steam profile
            </a>
            <FriendButton target={profile.user} />
            <ChallengeButton target={profile.user} />
          </div>
          {(profile.recentMatches.length > 0 || profile.favouriteWeapon) && (
            <div className={styles.heroMeta}>
              {profile.recentMatches.length > 0 && <RecentForm matches={profile.recentMatches} />}
              {profile.favouriteWeapon && <Favourite weapon={profile.favouriteWeapon} />}
            </div>
          )}
        </div>
      </header>

      {own && <ProfileNudge trust={viewer?.trust} enabled />}

      <section aria-labelledby="ratings-heading">
        <h2 id="ratings-heading" className="visually-hidden">
          Ratings
        </h2>
        <ul className={styles.ratings}>
          {MODES.map((m) => {
            const s = profile.modes.find((x) => x.mode === m);
            return (
              <li key={m}>
                <RatingCard mode={m} stats={s} active={m === mode} onSelect={() => setMode(m)} />
              </li>
            );
          })}
        </ul>
      </section>

      <Tabs label="Mode details" value={mode} onChange={setMode} items={MODES.map((m) => ({ key: m, label: MODE_COPY[m].label }))}>
        {stats ? <ModeDetail stats={stats} /> : <p className="muted">No matches in {modeLabel(mode)} yet.</p>}
      </Tabs>

      <div className="grid-2">
        <MatchHistory steamId={profile.user.steamId} first={profile.recentMatches} firstCursor={profile.recentMatchesCursor ?? null} />
        <section aria-labelledby="badges-heading" className="stack">
          <h2 id="badges-heading">Cup badges</h2>
          {profile.badges.length === 0 ? (
            <p className="muted">No cup placings yet.</p>
          ) : (
            <ul className={styles.badges}>
              {profile.badges.map((b) => (
                <li key={b.id} className={cx("glass", styles.badge)} data-kind={b.kind}>
                  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" className={styles.badgeIcon}>
                    <path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="currentColor" />
                  </svg>
                  <span className={styles.badgeText}>
                    <span className={styles.badgeTitle}>{BADGE_LABEL[b.kind]}</span>
                    <Link href={`/tournaments/${b.tournamentId}`}>{b.tournamentName}</Link>
                    <span className="muted">
                      {modeLabel(b.mode)}, {shortDate(b.awardedAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {viewer?.steamId === profile.user.steamId && <MyReports />}
    </div>
  );
}

function RatingCard({ mode, stats, active, onSelect }: { mode: Mode; stats?: ModeStats; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={cx("glass", styles.ratingCard, active && styles.active)} onClick={onSelect} aria-pressed={active}>
      <span className={styles.ratingTop}>
        <span className="eyebrow">{MODE_COPY[mode].label}</span>
      </span>
      <span className={styles.ratingValue}>
        {stats && stats.matches > 0 ? <TierChip tier={stats.tier} rating={stats.rating} /> : <TierChip unranked />}
      </span>
      <span className={styles.ratingSub}>
        {stats && stats.matches > 0 ? (stats.leaderboardRank ? `Rank #${stats.leaderboardRank}` : "Unplaced") : "\u00a0"}
      </span>
      {stats?.streak && stats.matches > 0 && <StreakLine streak={stats.streak} />}
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
        <StatTile label="Rating" value={<RatingText value={stats.rating} fallback={<TierChip tier={stats.tier} link={false} />} />} sub={`${signed(delta)} over ${stats.history.length} matches`} trend={delta > 0 ? "up" : delta < 0 ? "down" : "flat"} />
        <StatTile label="Win rate" value={formatStat(winRate(stats.wins, stats.matches), "pct", stats.matches)} sub={`${stats.wins}W ${stats.losses}L`} />
        <StatTile label="Headshot" value={formatStat(stats.headshotPct, "pct", stats.matches)} />
        <StatTile label="K/D" value={formatStat(stats.kd, "kd", stats.matches)} sub={`${stats.matches} matches`} />
      </div>
      <div className="grid-2">
        <Card title="Rating history">
          <RatingChart key={stats.mode} points={stats.history} label={`${MODE_COPY[stats.mode].label} rating history`} />
        </Card>
        <Card title="Best maps">
          {stats.bestMaps.length === 0 ? (
            <p className="muted">Not enough matches.</p>
          ) : (
            <ol className={styles.maps}>
              {stats.bestMaps.map((m) => {
                const wr = winRate(m.wins, m.matches);
                return (
                  <li key={m.mapId} className={styles.mapRow}>
                    <span className={styles.mapName}>
                      <MapThumb mapId={m.mapId} className={styles.mapThumb} />
                      <span className="mono">{mapName(stats.mode, m.mapId)}</span>
                    </span>
                    <span className={styles.bar} aria-hidden="true">
                      <span style={{ width: pct(wr) }} />
                    </span>
                    <span className="mono">{formatStat(wr, "pct", m.matches)}</span>
                    <span className="muted mono">{m.matches}</span>
                  </li>
                );
              })}
            </ol>
          )}
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
        Streak <span className="mono" data-sign={streak.current > 0 ? "up" : streak.current < 0 ? "down" : "none"}>{now}</span>
      </span>
      <span>
        Best <span className="mono">W{streak.longest}</span>
      </span>
    </span>
  );
}
