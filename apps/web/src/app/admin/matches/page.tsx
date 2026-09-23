"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Table, type Column } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { MODE_COPY, mapName } from "@/lib/modes";
import { adminApi } from "../_lib/client";
import { ago, scoreLine, shortId } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import type { MatchSummaryView } from "../_lib/types";
import { CancelMatchDialog } from "../_components/CancelMatchDialog";
import { ErrorPanel, MatchStatus, PageHeader, Teams } from "../_components/parts";
import styles from "../admin.module.css";

type View = "active" | "recent";

export default function AdminMatchesPage() {
  const [view, setView] = useState<View>("active");
  const live = useLiveData(() => adminApi.matches(view), [view], { kinds: ["match", "host"], pollMs: 15_000 });
  const now = useNow();
  const toast = useToast();
  const [target, setTarget] = useState<MatchSummaryView | null>(null);

  const idCol: Column<MatchSummaryView> = {
    key: "id",
    header: "Match",
    cell: (m) => (
      <span className="stack" style={{ gap: 0 }}>
        <Link href={`/admin/matches/${m.id}`} className="mono">
          {shortId(m.id)}
        </Link>
        <Link href={`/matches/${m.id}`} className={styles.muted}>
          Public page
        </Link>
      </span>
    ),
  };
  const modeCol: Column<MatchSummaryView> = {
    key: "mode",
    header: "Mode",
    cell: (m) => (
      <span className="stack" style={{ gap: 0 }}>
        <span>{MODE_COPY[m.mode].label}</span>
        {m.mapId && <span className={`${styles.muted} mono`}>{mapName(m.mode, m.mapId)}</span>}
      </span>
    ),
  };
  const teamsCol: Column<MatchSummaryView> = { key: "teams", header: "Players", cell: (m) => <Teams teams={m.teams} /> };
  const statusCol: Column<MatchSummaryView> = {
    key: "status",
    header: "Status",
    cell: (m) => (
      <span className="row">
        <MatchStatus status={m.status} />
        {m.source === "tournament" && <Badge tone="info">Cup</Badge>}
      </span>
    ),
  };

  const activeColumns: Column<MatchSummaryView>[] = [
    idCol,
    modeCol,
    statusCol,
    teamsCol,
    {
      key: "server",
      header: "Server",
      hideOnMobile: true,
      cell: (m) =>
        m.server ? (
          <span className="stack" style={{ gap: 0 }}>
            <span className="mono">
              {m.server.ip}:{m.server.port}
            </span>
          </span>
        ) : (
          <span className={styles.muted}>Not allocated</span>
        ),
    },
    { key: "age", header: "Age", numeric: true, hideOnMobile: true, cell: (m) => <span className={styles.nowrap}>{ago(m.createdAt, now).replace(" ago", "")}</span> },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (m) => (
        <Button variant="danger" onClick={() => setTarget(m)} aria-label={`Cancel match ${shortId(m.id)}`}>
          Cancel
        </Button>
      ),
    },
  ];

  const recentColumns: Column<MatchSummaryView>[] = [
    idCol,
    modeCol,
    statusCol,
    teamsCol,
    {
      key: "result",
      header: "Result",
      cell: (m) =>
        m.score ? (
          <span className="mono">{scoreLine(m.score)}</span>
        ) : (
          <span className={styles.muted}>{m.cancelReason ?? "--"}</span>
        ),
    },
    { key: "ended", header: "Ended", numeric: true, hideOnMobile: true, cell: (m) => <span className={styles.nowrap}>{ago(m.endedAt ?? m.createdAt, now)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Matches"
        description="Active matches with their server, and the most recent finished ones."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      <Tabs
        label="Match list"
        value={view}
        onChange={setView}
        items={[
          { key: "active", label: "Active" },
          { key: "recent", label: "Recent" },
        ]}
      >
        {live.error && !live.data ? (
          <ErrorPanel error={live.error} onRetry={live.reload} what="matches" />
        ) : (
          <Table
            caption={view === "active" ? "Active matches" : "Recent matches"}
            columns={view === "active" ? activeColumns : recentColumns}
            rows={live.data ?? []}
            rowKey={(m) => m.id}
            loading={!live.data}
            empty={view === "active" ? "No matches running." : "No finished matches yet."}
          />
        )}
      </Tabs>
      <CancelMatchDialog
        match={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          toast.push({ title: "Match cancelled", tone: "success" });
          live.reload();
        }}
      />
    </>
  );
}
