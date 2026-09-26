"use client";

import type { Mode } from "@rushsite/shared";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { MODE_COPY } from "@/lib/modes";
import { adminApi } from "../../_lib/client";
import { ACTIVITY_LABEL, activityDetail, ago, duration, hours, stamp } from "../../_lib/format";
import { useLiveData } from "../../_lib/live";
import type { ActivityEvent } from "../../_lib/types";
import { ErrorPanel } from "../../_components/parts";
import styles from "../../admin.module.css";

const modeLabel = (mode: string | null) => (mode ? (MODE_COPY[mode as Mode]?.label ?? mode) : null);

// Mode ids in a multi mode queue join read as labels
function detailText(kind: string | null, detail: string | null): string | null {
  const text = activityDetail(kind, detail);
  if (kind === "queue_join" && text && detail !== "requeue") return detail!.split(",").map((m) => modeLabel(m)).join(", ");
  return text;
}

function eventColumns(now: number): Column<ActivityEvent>[] {
  return [
    { key: "at", header: "When", cell: (e) => <span title={stamp(e.at)}>{ago(e.at, now)}</span> },
    { key: "kind", header: "What", cell: (e) => ACTIVITY_LABEL[e.kind] ?? e.kind },
    {
      key: "detail",
      header: "Detail",
      cell: (e) => {
        const parts = [modeLabel(e.mode), e.kind === "page_view" ? e.detail : detailText(e.kind, e.detail)].filter(Boolean);
        if (e.value !== null && (e.kind === "queue_leave" || e.kind === "queue_matched")) parts.push(`waited ${duration(Math.round(e.value))}`);
        if (e.value !== null && e.kind === "match_end") parts.push(`played ${duration(Math.round(e.value))}`);
        return <span className={styles.muted}>{parts.join(", ")}</span>;
      },
    },
  ];
}

export function ActivityCard({ steamId, now }: { steamId: string; now: number }) {
  const live = useLiveData(() => adminApi.userActivity(steamId), [steamId], { kinds: ["user"], pollMs: 60_000 });
  const a = live.data;
  const t = a?.totals;

  if (live.error && !a) return <ErrorPanel error={live.error} onRetry={live.reload} what="this player's activity" />;

  return (
    <>
      <Card title="Activity" eyebrow={t ? `Last seen ${ago(t.lastSeenAt, now)}` : undefined}>
        {!a ? (
          <p className="muted" aria-busy="true">
            Loading
          </p>
        ) : !t ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <dl className={styles.dl}>
            <dt>Last action</dt>
            <dd>
              {t.lastAction ? (ACTIVITY_LABEL[t.lastAction] ?? t.lastAction) : "None"}
              {t.lastAction && (
                <span className={styles.muted}>
                  {[modeLabel(t.lastActionMode), t.lastAction === "page_view" ? t.lastActionDetail : detailText(t.lastAction, t.lastActionDetail)]
                    .filter(Boolean)
                    .map((x) => `, ${x}`)
                    .join("")}
                  {t.lastActionAt ? `, ${ago(t.lastActionAt, now)}` : ""}
                </span>
              )}
            </dd>
            <dt>Last page</dt>
            <dd className="mono">{t.lastPage ?? "None"}</dd>
            <dt>Sessions</dt>
            <dd className="mono">
              {t.sessions}, {t.pageViews} page views
            </dd>
            <dt>Queued</dt>
            <dd className="mono">
              {t.queueJoins} times, {hours(t.queueSeconds)}
              {a.avgWaitSec !== null ? `, avg wait ${duration(Math.round(a.avgWaitSec))}` : ""}
            </dd>
            <dt>Matches</dt>
            <dd className="mono">
              {t.matchesFound} found, {t.matchesPlayed} played, {t.matchesWon} won
            </dd>
            <dt>Accept</dt>
            <dd className="mono">
              {t.matchesAccepted} accepted, {t.matchesDeclined} declined, {t.matchesMissed} missed
            </dd>
            <dt>Cups</dt>
            <dd className="mono">{t.cupSignups} sign ups</dd>
            <dt>First seen</dt>
            <dd>{stamp(t.firstSeenAt)}</dd>
          </dl>
        )}
      </Card>
      <Table
        caption="Recent activity"
        captionHidden={false}
        columns={eventColumns(now)}
        rows={a?.events ?? []}
        rowKey={(e) => `${e.at}|${e.kind}|${e.ref ?? ""}|${e.detail ?? ""}`}
        loading={!a}
        empty="No activity recorded."
      />
    </>
  );
}
