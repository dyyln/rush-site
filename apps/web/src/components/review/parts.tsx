import type { ReviewFlag, ReviewMatch, ReviewPlayer, ReviewReport, TrustLevel } from "@rushsite/shared";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { dateTime } from "@/lib/format";
import { mapName, MODE_COPY } from "@/lib/modes";
import { OutcomeBadge } from "./OutcomeBadge";
import { FLAG_STATUS, REASON } from "./copy";
import styles from "./review.module.css";

const TRUST: Record<TrustLevel, { label: string; tone: BadgeTone }> = {
  new: { label: "New", tone: "neutral" },
  verified: { label: "Verified", tone: "info" },
  trusted: { label: "Trusted", tone: "win" },
};

export function TrustBadge({ level }: { level: TrustLevel }) {
  return <Badge tone={TRUST[level].tone}>{TRUST[level].label}</Badge>;
}

export function FlagStatusBadge({ status }: { status: ReviewFlag["status"] }) {
  return <Badge tone={FLAG_STATUS[status].tone}>{FLAG_STATUS[status].label}</Badge>;
}

const pctText = (v: number | null) => (v === null ? "--" : `${Math.round(v * 100)}%`);

export function PlayerFacts({ player }: { player: ReviewPlayer }) {
  const s = player.stats;
  return (
    <dl className={styles.facts}>
      <div>
        <dt>Rating</dt>
        <dd className="mono">{s.rating ?? "--"}</dd>
      </div>
      <div>
        <dt>Matches</dt>
        <dd className="mono">
          {s.matches} <span className="muted">({s.wins}W)</span>
        </dd>
      </div>
      <div>
        <dt>K/D</dt>
        <dd className="mono">{s.kd ?? "--"}</dd>
      </div>
      <div>
        <dt>HS</dt>
        <dd className="mono">{pctText(s.headshotPct)}</dd>
      </div>
      <div>
        <dt>Reports</dt>
        <dd className="mono">{player.history.reportsReceived}</dd>
      </div>
      <div>
        <dt>Past cases</dt>
        <dd className="mono">
          {player.history.flagsConfirmed} confirmed, {player.history.flagsCleared} cleared
        </dd>
      </div>
    </dl>
  );
}

export function PlayerHead({ player, link = true }: { player: ReviewPlayer; link?: boolean }) {
  return (
    <div className={styles.playerHead}>
      <Avatar name={player.displayName} src={player.avatarUrl} size="md" />
      <div className={styles.playerText}>
        {link ? (
          <Link href={`/admin/users/${player.steamId}`} className={styles.playerName}>
            {player.displayName}
          </Link>
        ) : (
          <span className={styles.playerName}>{player.displayName}</span>
        )}
        <span className="row">
          <TrustBadge level={player.trustLevel} />
          {player.banned && <Badge tone="loss">Banned</Badge>}
          <span className="mono muted">{player.steamId}</span>
        </span>
      </div>
    </div>
  );
}

export function MatchLine({ match }: { match: ReviewMatch }) {
  const [a, b] = match.teams;
  return (
    <p className={styles.matchLine}>
      <span className="eyebrow">{MODE_COPY[match.mode].short}</span>
      {match.mapId && <span className="mono">{mapName(match.mode, match.mapId)}</span>}
      {a && b && (
        <span className="mono">
          {a.name} {a.score}:{b.score} {b.name}
        </span>
      )}
      {match.endedAt && <span className="muted">{dateTime(match.endedAt)}</span>}
    </p>
  );
}

export function ReportList({ reports }: { reports: ReviewReport[] }) {
  if (reports.length === 0) return <p className="muted">No player reports on this case.</p>;
  return (
    <ul className={styles.reports}>
      {reports.map((r) => (
        <li key={r.id} className={styles.report}>
          <div className={styles.reportHead}>
            <Link href={`/admin/users/${r.reporter.steamId}`}>{r.reporter.displayName}</Link>
            <TrustBadge level={r.reporter.trustLevel} />
            <Badge tone="accent">{REASON[r.reason]}</Badge>
            <OutcomeBadge outcome={r.outcome} />
            <span className="muted">{dateTime(r.createdAt)}</span>
          </div>
          {r.note ? <p className={styles.noteText}>{r.note}</p> : <p className="muted">No note.</p>}
        </li>
      ))}
    </ul>
  );
}
