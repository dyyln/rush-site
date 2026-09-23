"use client";

import Link from "next/link";
import { useState } from "react";
import { MODES, type Mode } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RatingSparkline } from "@/components/ui/RatingSparkline";
import { StatTile } from "@/components/ui/StatTile";
import { Table, type Column } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { TierChip } from "@/components/ui/TierChip";
import { api, ApiError } from "@/lib/api";
import { pct, shortDate, signed, winRate } from "@/lib/format";
import { MODE_COPY, mapName, modeLabel } from "@/lib/modes";
import type { BadgeKind, MatchSummary, ModeStats, Profile, TrustLevel } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
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

const matchColumns: Column<MatchSummary>[] = [
  {
    key: "result",
    header: "Result",
    cell: (m) => (
      <Badge tone={m.result === "win" ? "win" : m.result === "loss" ? "loss" : "warn"}>
        {m.result === "abandoned" ? "Forfeit" : m.result}
      </Badge>
    ),
  },
  { key: "mode", header: "Mode", cell: (m) => MODE_COPY[m.mode].short },
  { key: "map", header: "Map", cell: (m) => <span className="mono">{mapName(m.mode, m.mapId)}</span>, hideOnMobile: true },
  { key: "score", header: "Score", cell: (m) => (m.result === "abandoned" ? "--" : `${m.scoreFor}:${m.scoreAgainst}`), numeric: true },
  { key: "kd", header: "K/D", cell: (m) => `${m.kills}/${m.deaths}`, numeric: true, hideOnMobile: true },
  {
    key: "delta",
    header: "Rating",
    cell: (m) => <span className={m.ratingDelta >= 0 ? styles.up : styles.down}>{signed(m.ratingDelta)}</span>,
    numeric: true,
  },
  { key: "date", header: "Date", cell: (m) => shortDate(m.playedAt), align: "right", hideOnMobile: true },
];

export function ProfileView({ steamId }: { steamId: string }) {
  const data = useAsync(() => api.profile(steamId), [steamId]);

  if (data.status === "loading") {
    return (
      <div className="container page" aria-busy="true">
        <p className="muted">Loading profile</p>
      </div>
    );
  }
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
  const trust = TRUST[profile.user.trustLevel];

  return (
    <div className="container page">
      <header className={styles.hero}>
        <Avatar name={profile.user.displayName} src={profile.user.avatarUrl} size="lg" />
        <div className={styles.heroText}>
          <h1>{profile.user.displayName}</h1>
          <div className="row">
            <Badge tone={trust.tone}>{trust.label}</Badge>
            <Badge>{profile.user.region.toUpperCase()}</Badge>
            <a className={styles.steam} href={`https://steamcommunity.com/profiles/${profile.user.steamId}`} target="_blank" rel="noreferrer">
              Steam profile
            </a>
          </div>
        </div>
      </header>

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
        <section aria-labelledby="history-heading" className="stack">
          <h2 id="history-heading">Match history</h2>
          <Table caption="Recent matches" columns={matchColumns} rows={profile.recentMatches} rowKey={(m) => m.matchId} empty="No matches yet." />
        </section>
        <section aria-labelledby="badges-heading" className="stack">
          <h2 id="badges-heading">Cup badges</h2>
          {profile.badges.length === 0 ? (
            <p className="muted">No cup placings yet.</p>
          ) : (
            <ul className={styles.badges}>
              {profile.badges.map((b) => (
                <li key={b.id} className={styles.badge} data-kind={b.kind}>
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
    </div>
  );
}

function RatingCard({ mode, stats, active, onSelect }: { mode: Mode; stats?: ModeStats; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`${styles.ratingCard} ${active ? styles.active : ""}`} onClick={onSelect} aria-pressed={active}>
      <span className={styles.ratingTop}>
        <span className="eyebrow">{MODE_COPY[mode].label}</span>
      </span>
      <span className={styles.ratingValue}>{stats ? <TierChip tier={stats.tier} rating={stats.rating} /> : <span className="mono">--</span>}</span>
      <span className={styles.ratingSub}>
        {stats ? (stats.leaderboardRank ? `Rank #${stats.leaderboardRank}` : "Unplaced") : "No matches"}
      </span>
      {stats && (
        <span className={styles.ratingSpark}>
          <RatingSparkline points={stats.history} label={`${MODE_COPY[mode].label} rating trend`} width={200} height={40} />
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
        <StatTile label="Rating" value={stats.rating} sub={`${signed(delta)} over ${stats.history.length} matches`} trend={delta > 0 ? "up" : delta < 0 ? "down" : "flat"} />
        <StatTile label="Win rate" value={pct(winRate(stats.wins, stats.matches))} sub={`${stats.wins}W ${stats.losses}L`} />
        <StatTile label="Headshot" value={pct(stats.headshotPct)} />
        <StatTile label="K/D" value={stats.kd.toFixed(2)} sub={`${stats.matches} matches`} />
      </div>
      <div className="grid-2">
        <Card title="Rating history">
          <RatingSparkline points={stats.history} label={`${MODE_COPY[stats.mode].label} rating history`} width={400} height={180} detailed />
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
                    <span className="mono">{mapName(stats.mode, m.mapId)}</span>
                    <span className={styles.bar} aria-hidden="true">
                      <span style={{ width: pct(wr) }} />
                    </span>
                    <span className="mono">{pct(wr)}</span>
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
