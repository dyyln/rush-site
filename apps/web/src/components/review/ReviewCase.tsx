"use client";

import type { ReviewDecideResponse, ReviewFlag, ReviewMatchPlayer } from "@rushsite/shared";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { RoundTimeline } from "@/components/match/RoundTimeline";
import { buildRoster } from "@/components/match/roster";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { DecideForm } from "./DecideForm";
import { FlagStatusBadge, MatchLine, PlayerFacts, PlayerHead, ReportList } from "./parts";
import styles from "./review.module.css";

const num = (v: number | null) => (v === null ? "--" : Math.round(v));

function playerColumns(flagged: string): Column<ReviewMatchPlayer>[] {
  return [
    {
      key: "player",
      header: "Player",
      cell: (p) => (
        <Link href={`/admin/users/${p.steamId}`} className={p.steamId === flagged ? styles.flaggedName : undefined}>
          {p.displayName}
          {p.steamId === flagged && <span className="visually-hidden"> (flagged)</span>}
        </Link>
      ),
    },
    { key: "k", header: "K", numeric: true, cell: (p) => num(p.kills) },
    { key: "d", header: "D", numeric: true, cell: (p) => num(p.deaths) },
    { key: "hs", header: "HS", numeric: true, cell: (p) => num(p.headshots) },
    { key: "dmg", header: "DMG", numeric: true, hideOnMobile: true, cell: (p) => num(p.damage) },
  ];
}

export function ReviewCase({
  flag,
  viewer,
  onChange,
}: {
  flag: ReviewFlag;
  viewer: string | undefined;
  onChange: (flag: ReviewFlag, result?: ReviewDecideResponse) => void;
}) {
  const matchId = flag.match?.id;
  const detail = useAsync(() => (matchId ? api.match(matchId) : Promise.resolve(null)), [matchId]);
  const m = detail.data ?? null;
  // The flagged team shows as the enemy side so the suspect reads the same in every panel
  const flaggedTeam = flag.match?.flaggedTeam ?? 1;
  const ownIndex = flaggedTeam === 0 ? 1 : 0;
  const sideOf = (i: number): TeamSide => (i === ownIndex ? "own" : "enemy");
  const [a, b] = m?.teams ?? [];

  return (
    <div className={styles.caseGrid}>
      <div className={styles.caseMain}>
        {flag.match ? (
          <Card title="Match" actions={<Link href={`/matches/${flag.match.id}`}>Public page</Link>}>
            <div className="stack">
              <MatchLine match={flag.match} />
              <div className={styles.teamTables}>
                {flag.match.teams.map((t, i) => (
                  <div key={t.name} className="stack">
                    <h3 className={styles.teamHeading}>
                      <TeamMarker side={sideOf(i)} />
                      {t.name} <span className="mono muted">{t.score}</span>
                    </h3>
                    <Table
                      caption={`${t.name} players`}
                      columns={playerColumns(flag.player.steamId)}
                      rows={t.players}
                      rowKey={(p) => p.steamId}
                      highlight={(p) => p.steamId === flag.player.steamId}
                    />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ) : (
          <Card title="Match">
            <p className="muted">This case is not tied to a match.</p>
          </Card>
        )}

        {matchId && (
          <Card title="Timeline">
            {detail.status === "loading" && <p className="muted">Loading rounds</p>}
            {detail.status === "error" && <p className="muted">Could not load the rounds for this match.</p>}
            {m && a && b && (
              <RoundTimeline
                rounds={m.rounds}
                teamA={a.name}
                teamB={b.name}
                sideA={sideOf(0)}
                rush={m.mode === "rush3v3"}
                kills={m.kills}
                roster={buildRoster(m, ownIndex)}
                highlight={flag.player.steamId}
              />
            )}
          </Card>
        )}
      </div>

      <div className={styles.caseSide}>
        <Card title="Player">
          <div className="stack">
            <PlayerHead player={flag.player} />
            <PlayerFacts player={flag.player} />
          </div>
        </Card>
        <Card title={`Reports (${flag.reports.length})`}>
          <ReportList reports={flag.reports} />
        </Card>
        <Card
          title="Decision"
          actions={<FlagStatusBadge status={flag.status} />}
          eyebrow={`Flagged ${dateTime(flag.createdAt)} from ${flag.source}`}
        >
          <DecideForm flag={flag} viewer={viewer} onChange={onChange} />
        </Card>
      </div>
    </div>
  );
}
