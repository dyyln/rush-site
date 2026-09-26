"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { Table, type Column } from "@/components/ui/Table";
import { adminApi } from "../_lib/client";
import { ago, hostTone, shortId } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import type { AgentServerMetrics, HostView } from "../_lib/types";
import { ErrorPanel, Meter, PageHeader } from "../_components/parts";
import styles from "../admin.module.css";
import { DemoRecording } from "./DemoRecording";
import { GsltPool } from "./GsltPool";
import { HostHistory } from "./HostHistory";

const GB = 1024 ** 3;
const gb = (n: number) => `${(n / GB).toFixed(n >= 100 * GB ? 0 : 1)} GB`;
const share = (used?: number, total?: number) =>
  used === undefined || !total ? null : `${gb(used)} of ${gb(total)} (${Math.round((used / total) * 100)}%)`;

const serverColumns: Column<AgentServerMetrics>[] = [
  { key: "port", header: "Port", cell: (s) => <span className="mono">{s.port}</span> },
  {
    key: "match",
    header: "Match",
    cell: (s) => (s.matchId ? <Link href={`/admin/matches/${s.matchId}`} className="mono">{shortId(s.matchId)}</Link> : "--"),
  },
  { key: "cpu", header: "CPU", numeric: true, cell: (s) => (s.cpuPct === undefined ? "--" : `${s.cpuPct.toFixed(0)}%`) },
  { key: "rss", header: "Memory", numeric: true, cell: (s) => (s.rssBytes === undefined ? "--" : gb(s.rssBytes)) },
];

export default function AdminHostsPage() {
  const live = useLiveData(() => adminApi.hosts(), [], { kinds: ["host", "match"], pollMs: 15_000 });
  const now = useNow(5000);
  const hosts = live.data;
  const versions = new Set((hosts ?? []).map((h) => h.cs2Version).filter(Boolean));

  return (
    <>
      <PageHeader
        title="Hosts"
        description={
          versions.size > 1
            ? "Hosts report different CS2 versions. Players cannot join servers on an old build."
            : "Game server machines, slot capacity and CS2 build."
        }
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      {live.error && !hosts ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="hosts" />
      ) : !hosts ? (
        <p className="muted">Loading</p>
      ) : hosts.length === 0 ? (
        <p className="muted">No hosts registered. Set AGENT_URLS on the api.</p>
      ) : (
        <div className={styles.hostGrid}>
          {hosts.map((h) => (
            <HostCard key={h.id} host={h} now={now} />
          ))}
        </div>
      )}
      <DemoRecording />
      <GsltPool hosts={hosts} />
    </>
  );
}

function HostCard({ host: h, now }: { host: HostView; now: number }) {
  const stale = h.lastSeenAt ? now - Date.parse(h.lastSeenAt) > 60_000 : true;
  const m = h.metrics;
  const memory = share(m?.memUsedBytes, m?.memTotalBytes);
  const disk = share(m?.diskUsedBytes, m?.diskTotalBytes);
  return (
    <Card
      title={h.name}
      eyebrow={h.publicIp ?? "No public IP"}
      actions={
        <span className="row">
          <Badge tone={hostTone(h.status)}>{h.status}</Badge>
          {h.updating && h.status !== "updating" && <Badge tone="warn">Updating</Badge>}
        </span>
      }
    >
      <div className="stack">
        <dl className={styles.dl}>
          <dt>CS2 build</dt>
          <dd className="mono">{h.cs2Version ?? "unknown"}</dd>
          <dt>Slots</dt>
          <dd className="mono">
            {h.slots.used} used, {h.slots.free} free of {h.slots.total}
          </dd>
          <dt>Last seen</dt>
          <dd className={cx(stale && styles.loss)}>{ago(h.lastSeenAt, now)}</dd>
          {m?.cpuPct !== undefined && (
            <>
              <dt>CPU</dt>
              <dd className="mono">
                {m.cpuPct.toFixed(0)}%{m.cpus ? ` of ${m.cpus} threads` : ""}
              </dd>
            </>
          )}
          {m?.load && (
            <>
              <dt>Load</dt>
              <dd className="mono">{m.load.map((l) => l.toFixed(2)).join(" ")}</dd>
            </>
          )}
          {memory && (
            <>
              <dt>Memory</dt>
              <dd className="mono">{memory}</dd>
            </>
          )}
          {disk && (
            <>
              <dt>Disk</dt>
              <dd className="mono">{disk}</dd>
            </>
          )}
        </dl>
        {h.slots.total > 0 && <Meter value={h.slots.used} max={h.slots.total} label={`${h.name} slot usage`} />}
        {h.slots.total > 0 && (
          <div className={styles.slots} aria-label="Slots">
            {Array.from({ length: h.slots.total }, (_, i) => {
              const s = h.servers.find((x) => x.slotIndex === i);
              const label = s ? `Slot ${i}, port ${s.port ?? "?"}, ${s.status}${s.matchId ? `, match ${shortId(s.matchId)}` : ""}` : `Slot ${i}, free`;
              return s?.matchId ? (
                <Link key={i} href={`/admin/matches/${s.matchId}`} className={cx(styles.slot, styles.slotUsed)} title={label} aria-label={label} />
              ) : (
                <span key={i} className={cx(styles.slot, s && styles.slotUsed)} title={label} role="img" aria-label={label} />
              );
            })}
          </div>
        )}
        {h.updating && <p className={styles.muted}>Not taking new matches. Running matches finish, then SteamCMD updates and the host reopens.</p>}
        {m && (
          <Table
            caption="Running servers. CPU is percent of one core"
            captionHidden={false}
            columns={serverColumns}
            rows={m.servers}
            rowKey={(s) => `${s.port}-${s.pid}`}
            empty="No servers running."
          />
        )}
        {!m && h.status !== "offline" && <p className={styles.muted}>This agent does not report machine usage. Update it to see CPU, memory and servers.</p>}
        <HostHistory hostId={h.id} name={h.name} />
      </div>
    </Card>
  );
}
