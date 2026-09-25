"use client";

import { useEffect, useState } from "react";
import { MODES } from "@rushsite/shared";
import { BarChart, MODE_SERIES_COLOR, TimeSeriesChart, type ChartSeries } from "@/components/admin";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { MODE_COPY } from "@/lib/modes";
import { adminApi } from "../_lib/client";
import { duration } from "../_lib/format";
import { useLiveData } from "../_lib/live";
import type { MetricsRange, MetricsView } from "../_lib/types";
import { ErrorPanel } from "./parts";
import styles from "../admin.module.css";

const RANGE_KEY = "admin.metrics.range";
const RANGES: { value: MetricsRange; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

function perMode(m: Record<string, { t: number; v: number | null }[]>): ChartSeries[] {
  return MODES.map((mode) => ({ id: mode, label: MODE_COPY[mode].label, color: MODE_SERIES_COLOR[mode], points: m[mode] ?? [] }));
}

function stepText(sec: number): string {
  return sec >= 3600 ? `${sec / 3600} hour` : `${sec / 60} minute`;
}

export function Trends() {
  const [range, setRange] = useState<MetricsRange>("1h");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RANGE_KEY);
      if (saved === "1h" || saved === "24h" || saved === "7d") setRange(saved);
    } catch {
      // Storage can be blocked. The default range is fine
    }
  }, []);
  const live = useLiveData<MetricsView>(() => adminApi.metrics(range), [range], { kinds: [], pollMs: 60_000 });
  // Holds the previous range on screen while the next one loads
  const [last, setLast] = useState<MetricsView>();
  useEffect(() => {
    if (live.data) setLast(live.data);
  }, [live.data]);
  const m = live.data ?? last;

  function choose(v: MetricsRange) {
    setRange(v);
    try {
      localStorage.setItem(RANGE_KEY, v);
    } catch {
      // Not remembered, still applied
    }
  }

  return (
    <section aria-labelledby="ov-trends" className="stack">
      <div className={styles.sectionHead}>
        <h2 id="ov-trends" className="eyebrow">
          Trends
        </h2>
        <SegmentedControl label="Range" showLabel={false} options={RANGES} value={range} onChange={choose} />
      </div>
      {live.error && !m ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the metrics" />
      ) : (
        <div className={styles.charts}>
          <TimeSeriesChart
            title="Queue depth"
            sub={m ? `Players waiting, mean per ${stepText(m.stepSec)}` : "Players waiting"}
            series={m ? perMode(m.queueDepth) : []}
            stepSec={m?.stepSec ?? 60}
            refreshing={live.refreshing || !live.data}
          />
          <BarChart
            title="Matches found"
            sub={m ? `Every mode, per ${stepText(m.matchesStepSec)}` : "Every mode"}
            points={m?.matchesFound ?? []}
            stepSec={m?.matchesStepSec ?? 3600}
            color="var(--series-1)"
            refreshing={live.refreshing || !live.data}
          />
          <TimeSeriesChart
            title="Median wait"
            sub="Queue time of matches made, per mode"
            series={m ? perMode(m.medianWaitSec) : []}
            stepSec={m?.stepSec ?? 60}
            format={(v) => duration(Math.round(v))}
            refreshing={live.refreshing || !live.data}
          />
          <TimeSeriesChart
            title="Players online"
            sub="Signed in players with the site open. Several tabs count once"
            series={
              m
                ? [
                    { id: "online", label: "Players", color: "var(--series-1)", points: m.onlineUsers },
                    { id: "sockets", label: "Sockets", color: "var(--series-2)", points: m.activeSockets },
                  ]
                : []
            }
            stepSec={m?.stepSec ?? 60}
            refreshing={live.refreshing || !live.data}
          />
        </div>
      )}
    </section>
  );
}
