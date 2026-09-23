"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { MODE_COPY, mapName } from "@/lib/modes";
import { adminApi, isNotFound } from "../../_lib/client";
import { scoreLine, shortId, stamp } from "../../_lib/format";
import { useLiveData } from "../../_lib/live";
import type { MatchPlayerView } from "../../_lib/types";
import { ErrorPanel, MatchStatus, PageHeader, PlayerLink } from "../../_components/parts";
import { CancelMatchDialog } from "../../_components/CancelMatchDialog";
import styles from "../../admin.module.css";

const ACTIVE = ["accepting", "veto", "allocating", "starting", "ready", "live"];

const yes = (v: boolean | null) => (v === null ? "--" : v ? "Yes" : "No");

const columns: Column<MatchPlayerView>[] = [
  { key: "player", header: "Player", cell: (p) => <PlayerLink player={p} /> },
  { key: "team", header: "Team", cell: (p) => (p.team === 0 ? "A" : "B"), width: "64px" },
  { key: "accepted", header: "Accepted", cell: (p) => yes(p.accepted), hideOnMobile: true },
  {
    key: "connected",
    header: "Connected",
    cell: (p) => (p.abandoned ? <Badge tone="loss">Left</Badge> : yes(p.connected)),
  },
  { key: "kd", header: "K / D", numeric: true, cell: (p) => (p.kills === null ? "--" : `${p.kills} / ${p.deaths ?? 0}`) },
  { key: "hs", header: "HS", numeric: true, hideOnMobile: true, cell: (p) => p.headshots ?? "--" },
  {
    key: "won",
    header: "Result",
    cell: (p) => (p.won === null ? "--" : p.won ? <span className={styles.win}>Win</span> : <span className={styles.loss}>Loss</span>),
  },
];

export default function AdminMatchPage() {
  const { id } = useParams<{ id: string }>();
  const live = useLiveData(() => adminApi.match(id), [id], { kinds: ["match"], pollMs: 10_000 });
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const m = live.data;

  if (live.error && !m) {
    return (
      <>
        <PageHeader title={`Match ${shortId(id)}`} />
        {isNotFound(live.error) ? <p className="muted">No match with this id.</p> : <ErrorPanel error={live.error} onRetry={live.reload} what="the match" />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={m ? `${MODE_COPY[m.mode].label} match` : "Match"}
        description={<span className="mono">{id}</span>}
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
        actions={
          <>
            <Link href={`/matches/${id}`}>Public page</Link>
            {m && ACTIVE.includes(m.status) && (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                Cancel match
              </Button>
            )}
          </>
        }
      />
      <div className={styles.split}>
        <div className={styles.col}>
          <Table caption="Players" columns={columns} rows={m?.players ?? []} rowKey={(p) => p.steamId} loading={!m} empty="No player rows." />
          {m && m.rounds.length > 0 && (
            <Card title="Rounds">
              <dl className={styles.dl}>
                {m.rounds.map((r) => (
                  <div key={r.round} style={{ display: "contents" }}>
                    <dt className="mono">R{r.round}</dt>
                    <dd>
                      {r.winnerTeam} <span className="mono">{scoreLine(r.score)}</span>
                      {r.arena ? ` on ${r.arena}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
        <div className={styles.col}>
          <Card title="Details">
            {m ? (
              <dl className={styles.dl}>
                <dt>Status</dt>
                <dd>
                  <MatchStatus status={m.status} />
                </dd>
                <dt>Source</dt>
                <dd>{m.source}</dd>
                <dt>Map</dt>
                <dd>{m.mapId ? mapName(m.mode, m.mapId) : "--"}</dd>
                <dt>Score</dt>
                <dd className="mono">{m.score ? scoreLine(m.score) : "--"}</dd>
                <dt>Winner</dt>
                <dd>{m.winnerTeam ?? "--"}</dd>
                <dt>Server</dt>
                <dd className="mono">{m.server ? `${m.server.ip}:${m.server.port}` : "Not allocated"}</dd>
                {m.server?.connect && (
                  <>
                    <dt>Connect</dt>
                    <dd className={styles.connect}>{m.server.connect}</dd>
                  </>
                )}
                <dt>Created</dt>
                <dd>{stamp(m.createdAt)}</dd>
                <dt>Started</dt>
                <dd>{stamp(m.startedAt)}</dd>
                <dt>Ended</dt>
                <dd>{stamp(m.endedAt)}</dd>
                {m.cancelReason && (
                  <>
                    <dt>Cancel reason</dt>
                    <dd>{m.cancelReason}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="muted">Loading</p>
            )}
          </Card>
        </div>
      </div>
      <CancelMatchDialog
        match={cancelling && m ? m : null}
        onClose={() => setCancelling(false)}
        onDone={() => {
          toast.push({ title: "Match cancelled", tone: "success" });
          live.reload();
        }}
      />
    </>
  );
}
