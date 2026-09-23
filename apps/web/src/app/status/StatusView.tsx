"use client";

import { useEffect, useState } from "react";
import type { ServiceStatus } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { unavailableText } from "@/components/stats/copy";
import { statsApi } from "@/components/stats/statsApi";
import { dateTime } from "@/lib/format";
import { MODE_COPY } from "@/lib/modes";
import { useAsync } from "@/lib/useAsync";
import styles from "./status.module.css";

const REFRESH_MS = 30_000;
const REGION_NAMES: Record<string, string> = { eu: "Europe" };

function overall(s: ServiceStatus): { tone: "ok" | "warn" | "down"; text: string } {
  const down = s.modes.filter((m) => !m.available).length;
  if (down === s.modes.length) return { tone: "down", text: "No modes can queue right now" };
  if (down > 0 || s.regions.some((r) => r.updating)) return { tone: "warn", text: "Some modes are limited" };
  return { tone: "ok", text: "All modes are open" };
}

export function StatusView() {
  const data = useAsync(() => statsApi.status(), []);
  const { reload } = data;

  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  // Keep the last good answer so refreshes do not blank the page
  const [last, setLast] = useState<ServiceStatus | null>(null);
  useEffect(() => {
    if (data.data) setLast(data.data);
  }, [data.data]);
  const s = data.data ?? last;
  const summary = s ? overall(s) : null;

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Server status</h1>
          <p>Live capacity and queue availability. Refreshes every 30 seconds.</p>
        </div>
      </header>

      {data.status === "error" && !s && (
        <div className={styles.error} role="alert">
          <p>Could not load the status.</p>
          <Button variant="secondary" onClick={reload}>
            Retry
          </Button>
        </div>
      )}

      {data.status === "loading" && !s && <div className={styles.skeleton} aria-busy="true" />}

      {s && summary && (
        <div className="stack">
          <p className={styles.summary} data-tone={summary.tone} role="status">
            <span className={styles.dot} aria-hidden="true" />
            {summary.text}
          </p>

          <section aria-labelledby="status-modes">
            <h2 id="status-modes" className={styles.heading}>
              Modes
            </h2>
            <ul className={styles.modes}>
              {s.modes.map((m) => (
                <li key={m.mode} className={styles.mode} data-tone={m.available ? "ok" : "down"}>
                  <span className={styles.modeName}>{MODE_COPY[m.mode].label}</span>
                  <span className={styles.modeState}>
                    <span className={styles.dot} aria-hidden="true" />
                    {m.available ? "Open" : unavailableText(m.reason)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="status-regions">
            <h2 id="status-regions" className={styles.heading}>
              Regions
            </h2>
            <ul className={styles.regions}>
              {s.regions.map((r) => {
                const used = r.slotsTotal - r.slotsFree;
                const load = r.slotsTotal > 0 ? used / r.slotsTotal : 0;
                return (
                  <li key={r.region} className={styles.region}>
                    <div className={styles.regionHead}>
                      <span className={styles.regionName}>{REGION_NAMES[r.region] ?? r.region.toUpperCase()}</span>
                      {r.updating && <span className={styles.badge}>Updating CS2</span>}
                    </div>
                    <dl className={styles.facts}>
                      <div>
                        <dt>Hosts online</dt>
                        <dd className="mono">
                          {r.hostsOnline} / {r.hosts}
                        </dd>
                      </div>
                      <div>
                        <dt>Free servers</dt>
                        <dd className="mono">
                          {r.slotsFree} / {r.slotsTotal}
                        </dd>
                      </div>
                    </dl>
                    <div
                      className={styles.meter}
                      role="meter"
                      aria-label={`${REGION_NAMES[r.region] ?? r.region} servers in use`}
                      aria-valuemin={0}
                      aria-valuemax={r.slotsTotal}
                      aria-valuenow={used}
                    >
                      <span style={{ width: `${Math.round(load * 100)}%` }} data-high={load >= 0.85 ? "true" : undefined} />
                    </div>
                  </li>
                );
              })}
              <li className={styles.region}>
                <div className={styles.regionHead}>
                  <span className={styles.regionName}>Surge capacity</span>
                  <span className={styles.badge} data-tone={s.surge.enabled ? "ok" : undefined}>
                    {s.surge.enabled ? "Enabled" : "Off"}
                  </span>
                </div>
                <p className="muted">
                  {s.surge.enabled
                    ? "Extra cloud servers start when every dedicated server is busy."
                    : "Matches wait for a dedicated server when all are busy."}
                </p>
                <dl className={styles.facts}>
                  <div>
                    <dt>Surge servers running</dt>
                    <dd className="mono">{s.surge.active}</dd>
                  </div>
                </dl>
              </li>
            </ul>
          </section>

          <p className="muted mono">Updated {dateTime(s.updatedAt)}</p>
        </div>
      )}
    </div>
  );
}
