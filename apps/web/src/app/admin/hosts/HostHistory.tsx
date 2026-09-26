"use client";

import { useEffect, useState } from "react";
import { TimeSeriesChart } from "@/components/admin";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { adminApi } from "../_lib/client";
import { useLiveData } from "../_lib/live";
import type { HostMetricsView, MetricsRange } from "../_lib/types";
import { ErrorPanel } from "../_components/parts";
import styles from "../admin.module.css";

const RANGE_KEY = "admin.hosts.range";
const RANGES: { value: MetricsRange; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

const pct = (v: number) => `${Math.round(v)}%`;

function stepText(sec: number): string {
  return sec >= 3600 ? `${sec / 3600} hour` : `${sec / 60} minute`;
}

// Allocation, CPU and memory over time for one host. Each is its own chart on a fixed 0 to 100 scale
export function HostHistory({ hostId, name }: { hostId: string; name: string }) {
  const [range, setRange] = useState<MetricsRange>("1h");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RANGE_KEY);
      if (saved === "1h" || saved === "24h" || saved === "7d") setRange(saved);
    } catch {
      // Storage can be blocked. The default range is fine
    }
  }, []);
  const live = useLiveData<HostMetricsView>(() => adminApi.hostMetrics(hostId, range), [hostId, range], { kinds: [], pollMs: 60_000 });
  // Holds the previous range on screen while the next one loads
  const [last, setLast] = useState<HostMetricsView>();
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

  const sub = m ? `Mean per ${stepText(m.stepSec)}` : undefined;
  const busy = live.refreshing || !live.data;
  const chart = (title: string, color: string, points: HostMetricsView["cpuPct"] | undefined) => (
    <TimeSeriesChart
      title={title}
      sub={sub}
      series={[{ id: title, label: title, color, points: points ?? [] }]}
      stepSec={m?.stepSec ?? 60}
      format={pct}
      max={100}
      height={130}
      refreshing={busy}
    />
  );

  return (
    <section className="stack" aria-label={`${name} history`}>
      <div className={styles.sectionHead}>
        <h3 className="eyebrow">History</h3>
        <SegmentedControl label={`${name} range`} showLabel={false} options={RANGES} value={range} onChange={choose} />
      </div>
      {live.error && !m ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the host history" />
      ) : (
        <>
          {chart("Allocation", "var(--series-4)", m?.allocPct)}
          {chart("CPU", "var(--series-1)", m?.cpuPct)}
          {chart("Memory", "var(--series-5)", m?.memPct)}
        </>
      )}
    </section>
  );
}
