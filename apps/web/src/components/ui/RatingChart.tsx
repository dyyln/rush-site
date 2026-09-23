"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { TIERS } from "@rushsite/shared";
import { shortDate, signed } from "@/lib/format";
import type { RatingPoint } from "@/lib/types";
import { cx } from "./cx";
import { SegmentedControl } from "./SegmentedControl";
import styles from "./RatingChart.module.css";

export type RatingRange = "7d" | "30d" | "90d" | "all";

const DAY = 86_400_000;
const RANGE_DAYS: Record<RatingRange, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };
const RANGES: { value: RatingRange; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

type RatingChartProps = {
  points: RatingPoint[];
  label: string;
  // Small version for cards. No picker, axes or hover
  compact?: boolean;
  height?: number;
  defaultRange?: RatingRange;
};

type Pt = RatingPoint & { delta: number | null; index: number };

// Pixel width of the wrapper so text in the svg is never scaled
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function withDeltas(points: RatingPoint[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  return sorted.map((p, i) => ({ ...p, index: i, delta: i > 0 ? p.rating - sorted[i - 1]!.rating : null }));
}

// First range with at least two points, so the chart opens on something useful
function pickDefault(pts: Pt[], now: number): RatingRange {
  for (const r of ["30d", "90d"] as const) {
    const cut = now - RANGE_DAYS[r]! * DAY;
    if (pts.filter((p) => p.ts >= cut).length >= 2) return r;
  }
  return "all";
}

export function RatingChart({ points, label, compact, height, defaultRange }: RatingChartProps) {
  const all = useMemo(() => withDeltas(points), [points]);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const anchor = Math.max(now ?? 0, all.at(-1)?.ts ?? 0);
  const [range, setRange] = useState<RatingRange | null>(defaultRange ?? null);
  const active: RatingRange = compact ? "all" : (range ?? pickDefault(all, anchor));
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const h = height ?? (compact ? 48 : 220);

  const days = RANGE_DAYS[active];
  const cut = days === null ? (all[0]?.ts ?? 0) : anchor - days * DAY;
  const visible = all.filter((p) => p.ts >= cut);
  // The last point before the window carries the line in from the left edge
  const before = days === null ? undefined : all.filter((p) => p.ts < cut).at(-1);
  const drawn = before ? [before, ...visible] : visible;

  useEffect(() => setHover(null), [active]);

  const pad = compact ? { l: 2, r: 4, t: 4, b: 4 } : { l: 40, r: 12, t: 12, b: 26 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = h - pad.t - pad.b;

  const ratings = drawn.map((p) => p.rating);
  const min = ratings.length ? Math.min(...ratings) : 0;
  const max = ratings.length ? Math.max(...ratings) : 0;
  const span = Math.max(max - min, compact ? 40 : 80);
  const mid = (min + max) / 2;
  const lo = Math.floor(mid - span * 0.6);
  const hi = Math.ceil(mid + span * 0.6);
  const x0 = days === null ? (visible[0]?.ts ?? 0) : cut;
  const x1 = days === null ? Math.max(visible.at(-1)?.ts ?? 0, x0 + 1) : anchor;
  const x = (ts: number) => pad.l + ((ts - x0) / (x1 - x0)) * plotW;
  const y = (r: number) => pad.t + (1 - (r - lo) / (hi - lo)) * plotH;

  const bands = TIERS.map((t) => {
    const top = Math.min(t.max ?? Infinity, hi);
    const bottom = Math.max(t.min ?? -Infinity, lo);
    return top > bottom ? { t, y1: y(top), y2: y(bottom) } : null;
  }).filter((b) => b !== null);
  const bounds = TIERS.map((t) => t.min).filter((m): m is number => m !== null && m > lo && m < hi);

  const d = drawn.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
  const last = visible.at(-1);
  const hovered = hover !== null ? visible[hover] : undefined;

  // Snaps to the nearest point on the x axis
  function move(e: PointerEvent<SVGSVGElement>) {
    if (visible.length === 0) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    let dist = Infinity;
    visible.forEach((p, i) => {
      const dd = Math.abs(x(p.ts) - px);
      if (dd < dist) {
        dist = dd;
        best = i;
      }
    });
    setHover(best);
  }

  function key(e: KeyboardEvent<SVGSVGElement>) {
    if (visible.length === 0) return;
    const lastIdx = visible.length - 1;
    const cur = hover ?? lastIdx;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, hover === null ? lastIdx : cur - 1);
    else if (e.key === "ArrowRight") next = Math.min(lastIdx, hover === null ? lastIdx : cur + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = lastIdx;
    else if (e.key === "Escape") setHover(null);
    if (next !== null) {
      e.preventDefault();
      setHover(next);
    }
  }

  const first = visible[0];
  const change = first && last ? last.rating - (before ?? first).rating : 0;
  const summary =
    visible.length === 0
      ? `${label}: no rated matches in this range`
      : `${label}: ${(before ?? first)!.rating} to ${last!.rating}, ${signed(change)} over ${visible.length} ${visible.length === 1 ? "match" : "matches"}, low ${min}, high ${max}`;

  const enough = drawn.length >= 2;

  const picker = compact ? null : (
    <div className={styles.head}>
      <SegmentedControl label="Range" showLabel={false} options={RANGES} value={active} onChange={setRange} />
      {visible.length > 0 && (
        <p className={styles.change}>
          <span className={cx("mono", change >= 0 ? styles.up : styles.down)}>{signed(change)}</span>
          <span className="muted"> {active === "all" ? "all time" : `last ${RANGE_DAYS[active]} days`}</span>
        </p>
      )}
    </div>
  );

  if (all.length < 2) {
    return (
      <p className={cx(styles.empty, "muted")} role="img" aria-label={`${label}: not enough matches yet`}>
        Not enough matches yet
      </p>
    );
  }

  const tipLeft = hovered ? Math.min(Math.max(x(hovered.ts), 70), Math.max(70, width - 70)) : 0;

  return (
    <figure className={cx(styles.figure, compact && styles.compact)}>
      {picker}
      <div ref={wrapRef} className={styles.plot} style={{ height: h }}>
        {width > 0 && enough && (
          <svg
            width={width}
            height={h}
            className={styles.svg}
            role={compact ? undefined : "img"}
            aria-label={compact ? undefined : summary}
            aria-hidden={compact ? true : undefined}
            tabIndex={compact ? undefined : 0}
            onPointerMove={compact ? undefined : move}
            onPointerLeave={compact ? undefined : () => setHover(null)}
            onKeyDown={compact ? undefined : key}
            onBlur={compact ? undefined : () => setHover(null)}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={pad.l} y={pad.t - 6} width={plotW} height={plotH + 12} />
              </clipPath>
            </defs>
            {bands.map((b) => (
              <rect key={b.t.id} x={pad.l} width={plotW} y={b.y1} height={Math.max(0, b.y2 - b.y1)} className={styles.band} data-tier={b.t.id} />
            ))}
            {!compact &&
              bands
                .filter((b) => b.y2 - b.y1 >= 16)
                .map((b) => (
                  <text key={b.t.id} x={pad.l + 6} y={b.y1 + 12} className={styles.bandLabel}>
                    {b.t.displayName}
                  </text>
                ))}
            {!compact &&
              bounds.map((v) => (
                <g key={v}>
                  <line x1={pad.l} x2={pad.l + plotW} y1={y(v)} y2={y(v)} className={styles.bound} />
                  <text x={pad.l - 6} y={y(v) + 3} className={styles.axis} textAnchor="end">
                    {v}
                  </text>
                </g>
              ))}
            {!compact && bounds.length === 0 && (
              <>
                <text x={pad.l - 6} y={pad.t + 8} className={styles.axis} textAnchor="end">
                  {hi}
                </text>
                <text x={pad.l - 6} y={pad.t + plotH} className={styles.axis} textAnchor="end">
                  {lo}
                </text>
              </>
            )}
            {!compact && (
              <>
                <text x={pad.l} y={h - 6} className={styles.axis}>
                  {shortDate(x0)}
                </text>
                <text x={pad.l + plotW} y={h - 6} className={styles.axis} textAnchor="end">
                  {days === null ? shortDate(x1) : "Today"}
                </text>
              </>
            )}
            <g clipPath={`url(#${clipId})`}>
              <path key={active} d={d} pathLength={1} className={cx(styles.line, !compact && styles.draw)} />
            </g>
            {hovered && (
              <>
                <line x1={x(hovered.ts)} x2={x(hovered.ts)} y1={pad.t} y2={pad.t + plotH} className={styles.crosshair} />
                <circle cx={x(hovered.ts)} cy={y(hovered.rating)} r={4.5} className={styles.dot} />
              </>
            )}
            {!hovered && last && last.ts >= x0 && <circle cx={x(last.ts)} cy={y(last.rating)} r={compact ? 3 : 4} className={styles.dot} />}
          </svg>
        )}
        {width > 0 && !enough && (
          <p className={cx(styles.empty, styles.emptyRange, "muted")}>No rated matches in this range</p>
        )}
        {hovered && (
          <div
            className={styles.tip}
            style={y(hovered.rating) < h / 2 ? { left: tipLeft, bottom: pad.b + 4 } : { left: tipLeft, top: 0 }}
            aria-hidden="true"
          >
            <span className={styles.tipValue}>{hovered.rating}</span>
            {hovered.delta !== null && (
              <span className={cx("mono", hovered.delta >= 0 ? styles.up : styles.down)}>{signed(hovered.delta)}</span>
            )}
            <span className={styles.tipDate}>{shortDate(hovered.ts)}</span>
          </div>
        )}
      </div>
      {!compact && visible.length > 0 && (
        <details className={styles.data}>
          <summary>Data table</summary>
          <div className={styles.tableWrap}>
            <table>
              <caption className="visually-hidden">{label}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {[...visible].reverse().map((p) => (
                  <tr key={p.index}>
                    <td>{shortDate(p.ts)}</td>
                    <td className="mono">{p.rating}</td>
                    <td className="mono">{p.delta === null ? "–" : signed(p.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {!compact && (
        <p className="visually-hidden" aria-live="polite">
          {hovered ? `${shortDate(hovered.ts)}, rating ${hovered.rating}${hovered.delta !== null ? `, ${signed(hovered.delta)}` : ""}` : ""}
        </p>
      )}
    </figure>
  );
}
