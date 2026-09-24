"use client";

import type { MyReport } from "@rushsite/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OutcomeBadge } from "./OutcomeBadge";
import { REASON } from "./copy";
import { reviewApi } from "./api";
import styles from "./review.module.css";

// The viewer's reports in this match with where each one stands. Renders nothing without reports
export function MatchReportOutcomes({ matchId, reported }: { matchId: string; reported: string[] }) {
  const [rows, setRows] = useState<MyReport[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "done">("loading");
  const [attempt, setAttempt] = useState(0);
  const key = reported.join(",");

  useEffect(() => {
    if (!key) return;
    let live = true;
    setStatus("loading");
    reviewApi.myReports(matchId).then(
      (r) => {
        if (!live) return;
        setRows(r);
        setStatus("done");
      },
      () => live && setStatus("error"),
    );
    return () => {
      live = false;
    };
  }, [matchId, key, attempt]);

  // It sits in its own tab on a finished match, so loading and failure get a line instead of a blank panel
  if (status !== "done") {
    return (
      <Card tone="flat" className={styles.outcomes} aria-live="polite">
        {status === "loading" ? (
          <p className="muted">Loading your reports.</p>
        ) : (
          <p className="row">
            <span className="muted">Could not load your reports.</span>
            <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          </p>
        )}
      </Card>
    );
  }
  if (rows.length === 0) return null;
  return (
    <Card tone="flat" padded={false} className={styles.outcomes} aria-labelledby="my-reports-heading">
      <h2 id="my-reports-heading" className={styles.outcomesTitle}>
        Your reports
      </h2>
      <ul className={styles.outcomeList}>
        {rows.map((r) => (
          <li key={r.id} className={styles.outcomeRow}>
            <span className={styles.outcomeName}>{r.reported.displayName}</span>
            <span className="muted">{REASON[r.reason]}</span>
            <OutcomeBadge outcome={r.outcome} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
