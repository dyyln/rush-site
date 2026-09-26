"use client";

import type { Mode } from "@rushsite/shared";
import { useState } from "react";
import { BarChart, TimeSeriesChart } from "@/components/admin";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatTile } from "@/components/ui/StatTile";
import { Table, type Column } from "@/components/ui/Table";
import { MODE_COPY } from "@/lib/modes";
import { adminApi } from "../_lib/client";
import { ACTIVITY_LABEL, activityDetail, duration, hours } from "../_lib/format";
import { useLiveData } from "../_lib/live";
import type { ActivityOverview, ActivityRetention } from "../_lib/types";
import { ErrorPanel, PageHeader } from "../_components/parts";
import styles from "../admin.module.css";

type WindowKey = keyof ActivityOverview["windows"];
const WINDOWS: { value: WindowKey; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const DAY_SEC = 86_400;

const modeLabel = (mode: string) => MODE_COPY[mode as Mode]?.label ?? mode;
const wait = (sec: number | null) => (sec === null ? "--" : duration(Math.round(sec)));
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "--");

function retentionCell(r: ActivityRetention) {
  if (r.eligible === 0) return <span className={styles.muted}>--</span>;
  return (
    <span>
      {pct(r.returned, r.eligible)} <span className={styles.muted}>({r.returned}/{r.eligible})</span>
    </span>
  );
}

const modeColumns: Column<ActivityOverview["modes30d"][number]>[] = [
  { key: "mode", header: "Mode", cell: (m) => modeLabel(m.mode) },
  { key: "joins", header: "Queue joins", numeric: true, cell: (m) => m.queueJoins },
  { key: "found", header: "Found", numeric: true, cell: (m) => m.matchesFound },
  { key: "played", header: "Played", numeric: true, cell: (m) => m.matchesPlayed },
  { key: "wait", header: "Avg wait", numeric: true, cell: (m) => wait(m.avgWaitSec) },
];

const cohortColumns: Column<ActivityOverview["cohorts"][number]>[] = [
  { key: "week", header: "Signed up, week of", cell: (c) => <span className="mono">{c.week}</span> },
  { key: "players", header: "Players", numeric: true, cell: (c) => c.players },
  { key: "d1", header: "Day 1", numeric: true, cell: (c) => retentionCell(c.retention.d1) },
  { key: "d7", header: "Day 7", numeric: true, cell: (c) => retentionCell(c.retention.d7) },
  { key: "d30", header: "Day 30", numeric: true, cell: (c) => retentionCell(c.retention.d30) },
];

function lastActionColumns(total: number): Column<ActivityOverview["lastActions"][number]>[] {
  return [
    { key: "action", header: "Last action", cell: (l) => (l.action ? (ACTIVITY_LABEL[l.action] ?? l.action) : "Nothing recorded") },
    { key: "detail", header: "Detail", cell: (l) => <span className={styles.muted}>{activityDetail(l.action, l.detail) ?? ""}</span> },
    { key: "players", header: "Players", numeric: true, cell: (l) => l.players },
    { key: "share", header: "Share", numeric: true, hideOnMobile: true, cell: (l) => pct(l.players, total) },
  ];
}

export default function AdminActivityPage() {
  const [range, setRange] = useState<WindowKey>("7d");
  const live = useLiveData(() => adminApi.activity(), [], { kinds: [], pollMs: 5 * 60_000 });
  const o = live.data;
  const w = o?.windows[range];
  const days = o?.daily.map((d) => ({ ...d, t: Date.parse(`${d.day}T00:00:00Z`) })) ?? [];

  return (
    <>
      <PageHeader
        title="Activity"
        description="What players do on the site: queueing, matches, cups and pages, with retention by signup week."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      {live.error && !o ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the activity stats" />
      ) : (
        <>
          <section aria-labelledby="act-window" className="stack">
            <div className={styles.sectionHead}>
              <h2 id="act-window" className="eyebrow">
                Last {WINDOWS.find((x) => x.value === range)!.label}
              </h2>
              <SegmentedControl label="Range" showLabel={false} options={WINDOWS} value={range} onChange={setRange} />
            </div>
            <div className={styles.tiles}>
              <StatTile label="Active players" value={w?.activePlayers ?? "--"} sub={w ? `${w.newPlayers} new` : undefined} />
              <StatTile label="Queue joins" value={w?.queueJoins ?? "--"} sub={w ? `${hours(w.queueSeconds)} in queue` : undefined} />
              <StatTile label="Average wait" value={w ? wait(w.avgWaitSec) : "--"} sub="Until a match was found" />
              <StatTile label="Matches found" value={w?.matchesFound ?? "--"} sub={w ? `${w.matchesPlayed} played to the end` : undefined} />
              <StatTile label="Cup sign ups" value={w?.cupSignups ?? "--"} />
              <StatTile label="Page views" value={w?.pageViews ?? "--"} />
            </div>
          </section>

          <section aria-labelledby="act-daily" className="stack">
            <h2 id="act-daily" className="eyebrow">
              Last 30 days
            </h2>
            <div className={styles.charts}>
              <TimeSeriesChart
                title="Players per day"
                sub="Active and new players, UTC days"
                series={[
                  { id: "active", label: "Active", color: "var(--series-1)", points: days.map((d) => ({ t: d.t, v: d.activePlayers })) },
                  { id: "new", label: "New", color: "var(--series-2)", points: days.map((d) => ({ t: d.t, v: d.newPlayers })) },
                ]}
                stepSec={DAY_SEC}
                refreshing={live.refreshing || !o}
              />
              <BarChart
                title="Queue joins per day"
                sub="Every mode"
                points={days.map((d) => ({ t: d.t, v: d.queueJoins }))}
                stepSec={DAY_SEC}
                color="var(--series-1)"
                refreshing={live.refreshing || !o}
              />
              <BarChart
                title="Matches found per day"
                sub="Queue, cup and challenge matches"
                points={days.map((d) => ({ t: d.t, v: d.matchesFound }))}
                stepSec={DAY_SEC}
                color="var(--series-2)"
                refreshing={live.refreshing || !o}
              />
            </div>
            <Table
              caption="By mode, last 30 days"
              captionHidden={false}
              columns={modeColumns}
              rows={o?.modes30d ?? []}
              rowKey={(m) => m.mode}
              loading={!o}
              empty="No queue activity in the last 30 days."
            />
          </section>

          <section aria-labelledby="act-retention" className="stack">
            <h2 id="act-retention" className="eyebrow">
              Retention
            </h2>
            <p className={styles.muted}>
              Share of players who came back at least 1, 7 or 30 days after signing up. Only players who signed up long enough ago count.
            </p>
            <Table
              caption="Retention by signup week"
              columns={cohortColumns}
              rows={o?.cohorts ?? []}
              rowKey={(c) => c.week}
              loading={!o}
              empty="No sign ups in the last 8 weeks."
            />
          </section>

          <section aria-labelledby="act-left" className="stack">
            <h2 id="act-left" className="eyebrow">
              Last action before leaving
            </h2>
            <p className={styles.muted}>
              {o
                ? `${o.inactivePlayers} of ${o.totals.players} players have not been seen for ${o.inactiveDays} days. This is the last thing each of them did.`
                : "Players not seen for a week, by the last thing they did."}
            </p>
            <Table
              caption="Last action of inactive players"
              columns={lastActionColumns(o?.inactivePlayers ?? 0)}
              rows={o?.lastActions ?? []}
              rowKey={(l) => `${l.action}|${l.detail}`}
              loading={!o}
              empty="No inactive players yet."
            />
          </section>

          <section aria-labelledby="act-total" className="stack">
            <h2 id="act-total" className="eyebrow">
              All time
            </h2>
            <div className={styles.tiles}>
              <StatTile label="Players" value={o?.totals.players ?? "--"} sub={o ? `${o.totals.sessions} sessions` : undefined} />
              <StatTile label="Queue joins" value={o?.totals.queueJoins ?? "--"} sub={o ? `${hours(o.totals.queueSeconds)} in queue` : undefined} />
              <StatTile label="Matches found" value={o?.totals.matchesFound ?? "--"} sub={o ? `${o.totals.matchesPlayed} played` : undefined} />
              <StatTile label="Cup sign ups" value={o?.totals.cupSignups ?? "--"} />
              <StatTile label="Page views" value={o?.totals.pageViews ?? "--"} sub="Since tracking started" />
            </div>
          </section>
        </>
      )}
    </>
  );
}
