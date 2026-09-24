import type { ReviewFlag } from "@rushsite/shared";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { dateTime } from "@/lib/format";
import { REASON } from "./copy";
import { FlagStatusBadge, MatchLine, PlayerFacts, PlayerHead } from "./parts";
import styles from "./review.module.css";

// One case in the queue: who, which match, what reporters said
export function ReviewQueueItem({ flag }: { flag: ReviewFlag }) {
  const reasons = [...new Set(flag.reports.map((r) => r.reason))];
  const notes = flag.reports.filter((r) => r.note);
  return (
    <Card as="article" tone="flat" padded={false} className={styles.item} aria-labelledby={`case-${flag.id}`}>
      <div className={styles.itemHead}>
        <PlayerHead player={flag.player} link={false} />
        <div className={styles.itemMeta}>
          <FlagStatusBadge status={flag.status} />
          {flag.reviewer && flag.status === "reviewing" && <span className="muted">{flag.reviewer.displayName}</span>}
          <span className="muted">{dateTime(flag.createdAt)}</span>
        </div>
      </div>
      {flag.match && <MatchLine match={flag.match} />}
      <PlayerFacts player={flag.player} />
      <div className="row">
        <span className="muted">
          {flag.reports.length} {flag.reports.length === 1 ? "report" : "reports"}
        </span>
        {reasons.map((r) => (
          <Badge key={r} tone="accent">
            {REASON[r]}
          </Badge>
        ))}
      </div>
      {notes.length > 0 && (
        <ul className={styles.notes}>
          {notes.slice(0, 2).map((r) => (
            <li key={r.id} className={styles.noteText}>
              {r.note}
            </li>
          ))}
        </ul>
      )}
      <Link id={`case-${flag.id}`} href={`/admin/review/${flag.id}`} className={styles.open}>
        Open case of {flag.player.displayName}
      </Link>
    </Card>
  );
}
