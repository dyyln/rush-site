"use client";

import Link from "next/link";
import { useState } from "react";
import { MODES, type Mode } from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { MODE_COPY, isMode } from "@/lib/modes";
import { STATUS_LABEL, formatLabel } from "@/lib/tournaments";
import type { TournamentStatus, TournamentSummary } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import styles from "./tournaments.module.css";

type View = "upcoming" | "live" | "past";
const VIEW_STATUS: Record<View, TournamentStatus[]> = {
  upcoming: ["open"],
  live: ["running"],
  past: ["completed", "cancelled"],
};

export function TournamentsView() {
  const [view, setView] = useState<View>("upcoming");
  const [mode, setMode] = useState<Mode | "all">("all");
  const data = useAsync(
    () => api.tournaments.list({ status: VIEW_STATUS[view], mode: mode === "all" ? undefined : mode }),
    [view, mode],
  );

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Tournaments</h1>
          <p>Free daily and weekly cups. Verified players only. Placings earn profile badges.</p>
        </div>
        <Select
          label="Mode"
          className={styles.filter}
          value={mode}
          onChange={(e) => setMode(isMode(e.target.value) ? e.target.value : "all")}
          options={[{ value: "all", label: "All modes" }, ...MODES.map((m) => ({ value: m, label: MODE_COPY[m].label }))]}
        />
      </header>

      <Tabs
        label="Tournament status"
        value={view}
        onChange={setView}
        items={[
          { key: "upcoming", label: "Upcoming" },
          { key: "live", label: "Live" },
          { key: "past", label: "Past" },
        ]}
      >
        {data.status === "error" && (
          <div className={styles.error} role="alert">
            <p>Could not load tournaments.</p>
            <Button variant="secondary" onClick={data.reload}>
              Retry
            </Button>
          </div>
        )}
        {data.status === "loading" && <p className="muted">Loading</p>}
        {data.status === "success" &&
          (data.data.length === 0 ? (
            <p className="muted">No tournaments here right now.</p>
          ) : (
            <ul className={styles.list}>
              {data.data.map((t) => (
                <li key={t.id}>
                  <TournamentCard t={t} />
                </li>
              ))}
            </ul>
          ))}
      </Tabs>
    </div>
  );
}

function TournamentCard({ t }: { t: TournamentSummary }) {
  const status = STATUS_LABEL[t.status];
  const fill = Math.min(1, t.entrantCount / t.maxEntrants);
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge>{t.cadence}</Badge>
      </div>
      <h2 className={styles.cardTitle}>
        <Link href={`/tournaments/${t.id}`} className={styles.cardLink}>
          {t.name}
        </Link>
      </h2>
      <p className={styles.mode}>{MODE_COPY[t.mode].label}</p>
      <dl className={styles.facts}>
        <div>
          <dt>Starts</dt>
          <dd className="mono">{dateTime(t.startsAt)}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{formatLabel(t)}</dd>
        </div>
        <div>
          <dt>Entrants</dt>
          <dd className="mono">
            {t.entrantCount} / {t.maxEntrants}
          </dd>
        </div>
      </dl>
      <span className={styles.fill} aria-hidden="true">
        <span style={{ width: `${fill * 100}%` }} />
      </span>
    </article>
  );
}
