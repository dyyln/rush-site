"use client";

import { useId, useState, type PointerEvent } from "react";
import { cx } from "@/components/ui/cx";
import { compact, fullTime, niceMax, ticks, timeLabel, xTickIndexes } from "./scale";
import { useWidth } from "./useWidth";
import styles from "./charts.module.css";

export type ChartPoint = { t: number; v: number | null };
export type ChartSeries = { id: string; label: string; color: string; points: ChartPoint[] };

type Props = {
  title: string;
  sub?: string;
  series: ChartSeries[];
  stepSec: number;
  format?: (v: number) => string;
  height?: number;
  refreshing?: boolean;
};

const PAD = { top: 8, right: 12, bottom: 22, left: 40 };

// Splits a series at nulls so gaps in sampling show as gaps
function pathOf(points: ChartPoint[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function TimeSeriesChart({ title, sub, series, stepSec, format = compact, height = 200, refreshing }: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const n = series[0]?.points.length ?? 0;
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const values = series.flatMap((s) => s.points.map((p) => p.v).filter((v): v is number => v !== null));
  const max = niceMax(Math.max(0, ...values));
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const span = n > 1 ? series[0]!.points[n - 1]!.t - series[0]!.points[0]!.t : 0;
  const empty = values.length === 0;

  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  }

  const hx = hover !== null ? x(hover) : 0;
  const tipLeft = hover !== null ? Math.min(Math.max(hx + 12, 0), width - 170) : 0;
  const tipFlip = hover !== null && hx + 180 > width;

  return (
    <figure className={styles.viz} style={{ margin: 0 }}>
      <div className={styles.head}>
        <figcaption>
          <p className={styles.title}>{title}</p>
          {sub && <p className={styles.sub}>{sub}</p>}
        </figcaption>
        {series.length > 1 && (
          <ul className={styles.legend} aria-label="Legend">
            {series.map((s) => (
              <li key={s.id}>
                <span className={styles.key} style={{ background: s.color }} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={ref} className={cx(styles.plot, refreshing && styles.refreshing)}>
        <svg width={width} height={height} role="img" aria-label={`${title}. Values in the table below`}>
          {ticks(max).map((v) => (
            <g key={v}>
              <line className={styles.gridline} x1={PAD.left} x2={PAD.left + innerW} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5} />
              <text className={styles.tick} x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {format(v)}
              </text>
            </g>
          ))}
          {n > 0 &&
            xTickIndexes(n, Math.max(2, Math.floor(innerW / 90))).map((i) => (
              <text key={i} className={styles.tick} x={x(i)} y={height - 4} textAnchor={i === 0 ? "start" : "middle"}>
                {timeLabel(series[0]!.points[i]!.t, span)}
              </text>
            ))}
          {series.map((s) => (
            <path key={s.id} className={styles.line} d={pathOf(s.points, x, y)} style={{ stroke: s.color }} />
          ))}
          {hover !== null && (
            <g>
              <line className={styles.crosshair} x1={Math.round(hx) + 0.5} x2={Math.round(hx) + 0.5} y1={PAD.top} y2={PAD.top + innerH} />
              {series.map((s) => {
                const v = s.points[hover]?.v;
                return v === null || v === undefined ? null : <circle key={s.id} className={styles.dot} cx={hx} cy={y(v)} r={4} style={{ fill: s.color }} />;
              })}
            </g>
          )}
          <rect
            x={PAD.left}
            y={0}
            width={innerW}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {empty && <p className={styles.empty}>No samples in this range yet</p>}
        {hover !== null && n > 0 && (
          <div className={styles.tooltip} style={tipFlip ? { left: Math.max(0, hx - 180) } : { left: tipLeft }} aria-hidden="true">
            <p className={styles.tipTime}>{fullTime(series[0]!.points[hover]!.t, stepSec)}</p>
            <ul className={styles.tipRows}>
              {series.map((s) => {
                const v = s.points[hover]?.v;
                return (
                  <li key={s.id} className={styles.tipRow}>
                    <span className={styles.key} style={{ background: s.color }} />
                    {s.label}
                    <span className={styles.tipValue}>{v === null || v === undefined ? "no data" : format(v)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <details className={styles.table}>
        <summary aria-controls={tableId}>Table</summary>
        <div className={styles.tableWrap} id={tableId}>
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                {series.map((s) => (
                  <th key={s.id} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(series[0]?.points ?? [])
                .map((p, i) => ({ p, i }))
                .reverse()
                .map(({ p, i }) => (
                  <tr key={p.t}>
                    <td>{fullTime(p.t, stepSec)}</td>
                    {series.map((s) => {
                      const v = s.points[i]?.v;
                      return <td key={s.id}>{v === null || v === undefined ? "--" : format(v)}</td>;
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
