"use client";

import type { MyReport } from "@rushsite/shared";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Table, type Column } from "@/components/ui/Table";
import { shortDate } from "@/lib/format";
import { MODE_COPY } from "@/lib/modes";
import { useAsync } from "@/lib/useAsync";
import { OutcomeBadge } from "./OutcomeBadge";
import { REASON } from "./copy";
import { reviewApi } from "./api";
import styles from "./review.module.css";

const columns: Column<MyReport>[] = [
  {
    key: "player",
    header: "Player",
    cell: (r) => <Link href={`/profile/${r.reported.steamId}`} className={styles.cellLink}>{r.reported.displayName}</Link>,
  },
  { key: "reason", header: "Reason", cell: (r) => REASON[r.reason] },
  {
    key: "match",
    header: "Match",
    hideOnMobile: true,
    cell: (r) => (r.matchId ? <Link href={`/matches/${r.matchId}`} className={styles.cellLink}>{r.match ? MODE_COPY[r.match.mode].short : "Match"}</Link> : "--"),
  },
  { key: "outcome", header: "Outcome", cell: (r) => <OutcomeBadge outcome={r.outcome} /> },
  { key: "date", header: "Reported", align: "right", hideOnMobile: true, cell: (r) => shortDate(r.createdAt) },
];

// Own profile only. Other players never see who reported them
export function MyReports() {
  const data = useAsync(() => reviewApi.myReports(), []);
  return (
    <section aria-labelledby="your-reports-heading" className="stack">
      <h2 id="your-reports-heading">Your reports</h2>
      <p className="muted">Only you can see this list. Each report shows where its case stands.</p>
      {data.status === "error" ? (
        <div className="row">
          <p className="muted">Could not load your reports.</p>
          <Button variant="secondary" onClick={data.reload}>
            Retry
          </Button>
        </div>
      ) : (
        <Table
          caption="Your reports"
          columns={columns}
          rows={data.status === "success" ? data.data : []}
          rowKey={(r) => r.id}
          loading={data.status === "loading"}
          empty="You have not reported anyone."
        />
      )}
    </section>
  );
}
