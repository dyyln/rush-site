"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { adminApi } from "./_lib/client";
import { useLiveData } from "./_lib/live";
import type { Health, OverviewView } from "./_lib/types";
import { Dot, ErrorPanel, PageHeader } from "./_components/parts";
import { QueueToggles } from "./_components/QueueToggles";
import { Trends } from "./_components/Trends";
import styles from "./admin.module.css";

const HEALTH_LABEL: Record<keyof OverviewView["health"], string> = {
  db: "Postgres",
  redis: "Redis",
  queue: "Queue state",
  matches: "Match state",
  hosts: "Host agents",
  events: "Event log",
};

export default function AdminOverviewPage() {
  const live = useLiveData(() => adminApi.overview(), [], { kinds: "all", pollMs: 15_000 });
  const o = live.data;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Queues, matches, servers and platform health at a glance."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      {live.error && !o ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the overview" />
      ) : (
        <>
          <section aria-labelledby="ov-health" className="stack">
            <h2 id="ov-health" className="eyebrow">
              Health
            </h2>
            <div className={styles.healthGrid}>
              {o
                ? (Object.keys(HEALTH_LABEL) as (keyof OverviewView["health"])[]).map((k) => (
                    <HealthTile key={k} name={HEALTH_LABEL[k]} health={o.health[k]} />
                  ))
                : Object.values(HEALTH_LABEL).map((n) => <HealthTile key={n} name={n} />)}
            </div>
          </section>

          <section aria-labelledby="ov-live" className="stack">
            <h2 id="ov-live" className="eyebrow">
              Right now
            </h2>
            <div className={styles.tiles}>
              <Tile href="/admin/queue" label="In queue" value={o && o.queue.reduce((n, q) => n + q.players, 0)} sub={o && `${o.queue.reduce((n, q) => n + q.tickets, 0)} tickets`} />
              <Tile
                href="/admin/matches"
                label="Active matches"
                value={o?.matches.active}
                sub={o && `${o.matches.byStatus.live ?? 0} live`}
              />
              <Tile
                href="/admin/hosts"
                label="Free slots"
                value={o && `${o.hosts.slotsFree}/${o.hosts.slotsTotal}`}
                sub={o && `${o.hosts.online}/${o.hosts.total} hosts online${o.hosts.updating ? `, ${o.hosts.updating} updating` : ""}`}
                trend={o && o.hosts.slotsFree === 0 ? "down" : undefined}
              />
              <Tile
                href="/admin/events"
                label="Errors, last hour"
                value={o?.events.errorsLastHour}
                sub={o && `${o.events.webhooksLastHour} webhooks, ${o.events.failedWebhooksLastHour} rejected`}
                trend={o && o.events.errorsLastHour > 0 ? "down" : undefined}
              />
            </div>
          </section>

          <section aria-labelledby="ov-queue" className="stack">
            <h2 id="ov-queue" className="eyebrow">
              Queues
            </h2>
            <QueueToggles queue={o?.queue} onChanged={live.reload} />
          </section>

          <Trends />

          <section aria-labelledby="ov-day" className="stack">
            <h2 id="ov-day" className="eyebrow">
              Last 24 hours
            </h2>
            <div className={styles.tiles}>
              <Tile label="Matches finished" value={o?.matches.finished24h} />
              <Tile label="Matches abandoned" value={o?.matches.abandoned24h} trend={o && o.matches.abandoned24h > 0 ? "down" : undefined} sub={o ? "Forfeits and no shows" : undefined} />
              <Tile label="New users" value={o?.users.new24h} sub={o && `${o.users.total} total`} />
            </div>
          </section>

          <section aria-labelledby="ov-mod" className="stack">
            <h2 id="ov-mod" className="eyebrow">
              Fair play
            </h2>
            <div className={styles.tiles}>
              <Tile label="Active bans" value={o?.moderation.activeBans} />
              <Tile label="Open reports" value={o?.moderation.openReports} />
              <Tile label="Open flags" value={o?.moderation.openFlags} />
            </div>
          </section>

          {o && Object.keys(o.matches.byStatus).length > 0 && (
            <Card title="Match pipeline">
              <dl className={styles.dl}>
                {Object.entries(o.matches.byStatus).map(([status, n]) => (
                  <div key={status} style={{ display: "contents" }}>
                    <dt>{status}</dt>
                    <dd className="mono">{n}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  sub,
  href,
  trend,
}: {
  label: string;
  value: number | string | undefined | null;
  sub?: string | null;
  href?: string;
  trend?: "up" | "down";
}) {
  const tile = <StatTile label={label} value={value ?? "--"} sub={sub ?? undefined} trend={trend} />;
  if (!href) return tile;
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      {tile}
    </Link>
  );
}

function HealthTile({ name, health }: { name: string; health?: Health }) {
  const tone = !health ? "off" : health.ok ? ((health.latencyMs ?? 0) > 250 ? "warn" : "ok") : "bad";
  return (
    <div className={styles.health}>
      <span className={styles.healthName}>
        <Dot tone={tone} />
        {name}
      </span>
      <span className={`${styles.muted} mono`} title={health?.error}>
        {!health ? "--" : health.ok ? `${health.latencyMs ?? 0} ms` : "down"}
      </span>
    </div>
  );
}
