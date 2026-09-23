"use client";

import { useId, useState } from "react";
import { cx } from "@/components/ui/cx";
import type { ChartPoint } from "./TimeSeriesChart";
import { compact, fullTime, niceMax, ticks, timeLabel, xTickIndexes } from "./scale";
import { useWidth } from "./useWidth";
import styles from "./charts.module.css";

type Props = {
  title: string;
  sub?: string;
  points: ChartPoint[];
  stepSec: number;
  color: string;
  height?: number;
  refreshing?: boolean;
};

const PAD = { top: 8, right: 12, bottom: 22, left: 40 };
const GAP = 2;
const MAX_BAR = 24;
const RADIUS = 4;

// Column with a rounded top and a square base
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function BarChart({ title, sub, points, stepSec, color, height = 200, refreshing }: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const n = points.length;
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...points.map((p) => p.v ?? 0)));
  const slot = n > 0 ? innerW / n : innerW;
  const barW = Math.max(1, Math.min(MAX_BAR, slot - GAP));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const span = n > 1 ? points[n - 1]!.t - points[0]!.t : 0;
  const empty = points.every((p) => !p.v);
  const hx = hover !== null ? PAD.left + slot * hover + slot / 2 : 0;

  return (
    <figure className={styles.viz} style={{ margin: 0 }}>
      <div className={styles.head}>
        <figcaption>
          <p className={styles.title}>{title}</p>
          {sub && <p className={styles.sub}>{sub}</p>}
        </figcaption>
      </div>
      <div ref={ref} className={cx(styles.plot, refreshing && styles.refreshing)}>
        <svg width={width} height={height} role="img" aria-label={`${title}. Values in the table below`}>
          {ticks(max).map((v) => (
            <g key={v}>
              <line className={styles.gridline} x1={PAD.left} x2={PAD.left + innerW} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5} />
              <text className={styles.tick} x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {compact(v)}
              </text>
            </g>
          ))}
          {n > 0 &&
            xTickIndexes(n, Math.max(2, Math.floor(innerW / 90))).map((i) => (
              <text key={i} className={styles.tick} x={PAD.left + slot * i + slot / 2} y={height - 4} textAnchor={i === 0 ? "start" : "middle"}>
                {timeLabel(points[i]!.t, span)}
              </text>
            ))}
          {points.map((p, i) => {
            const v = p.v ?? 0;
            const h = (v / max) * innerH;
            const bx = PAD.left + slot * i + (slot - barW) / 2;
            return (
              <g key={p.t}>
                {h > 0 && (
                  <path
                    className={cx(styles.bar, hover !== null && hover !== i && styles.barDim)}
                    d={column(bx, PAD.top + innerH - h, barW, h)}
                    style={{ fill: color }}
                  />
                )}
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        {empty && <p className={styles.empty}>No matches found in this range</p>}
        {hover !== null && points[hover] && (
          <div className={styles.tooltip} style={{ left: hx + 180 > width ? Math.max(0, hx - 180) : hx + 12 }} aria-hidden="true">
            <p className={styles.tipTime}>{fullTime(points[hover]!.t, stepSec)}</p>
            <p className={styles.tipRow} style={{ margin: 0 }}>
              Matches found
              <span className={styles.tipValue}>{points[hover]!.v === null ? "no data" : compact(points[hover]!.v!)}</span>
            </p>
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
                <th scope="col">Matches found</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.t}>
                  <td>{fullTime(p.t, stepSec)}</td>
                  <td>{p.v === null ? "--" : compact(p.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
