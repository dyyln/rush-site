"use client";

import type { MyReport } from "@rushsite/shared";
import { useEffect, useState } from "react";
import { OutcomeBadge } from "./OutcomeBadge";
import { REASON } from "./copy";
import { reviewApi } from "./api";
import styles from "./review.module.css";

// The viewer's reports in this match with where each one stands. Renders nothing without reports
export function MatchReportOutcomes({ matchId, reported }: { matchId: string; reported: string[] }) {
  const [rows, setRows] = useState<MyReport[]>([]);
  const key = reported.join(",");

  useEffect(() => {
    if (!key) return;
    let live = true;
    reviewApi.myReports(matchId).then(
      (r) => live && setRows(r),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [matchId, key]);

  if (rows.length === 0) return null;
  return (
    <section className={styles.outcomes} aria-labelledby="my-reports-heading">
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
    </section>
  );
}
