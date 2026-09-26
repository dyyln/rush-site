"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { adminApi } from "../_lib/client";
import { ago, hostTone, shortId } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import type { HostView } from "../_lib/types";
import { ErrorPanel, Meter, PageHeader } from "../_components/parts";
import styles from "../admin.module.css";
import { DemoRecording } from "./DemoRecording";
import { GsltPool } from "./GsltPool";

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
      </div>
    </Card>
  );
}
