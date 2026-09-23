"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Table, type Column } from "@/components/ui/Table";
import { adminApi } from "../_lib/client";
import { clock, shortId, stamp } from "../_lib/format";
import { useLiveData } from "../_lib/live";
import type { EventView } from "../_lib/types";
import { ErrorPanel, PageHeader } from "../_components/parts";
import styles from "../admin.module.css";

type Filter = "all" | "webhook" | "error" | "failed";

export default function AdminEventsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(100);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const live = useLiveData(() => adminApi.events(limit), [limit], {
    kinds: paused ? [] : ["webhook", "error"],
    pollMs: paused ? 3_600_000 : 20_000,
  });

  const rows = (live.data ?? []).filter((e) =>
    filter === "all" ? true : filter === "failed" ? !e.ok : e.kind === filter,
  );

  const columns: Column<EventView>[] = [
    {
      key: "at",
      header: "Time",
      cell: (e) => (
        <span className="mono" title={stamp(e.at)}>
          {clock(e.at)}
        </span>
      ),
      width: "96px",
    },
    {
      key: "kind",
      header: "Kind",
      cell: (e) => (e.kind === "error" ? <Badge tone="loss">Error</Badge> : e.ok ? <Badge tone="info">Webhook</Badge> : <Badge tone="warn">Rejected</Badge>),
    },
    { key: "type", header: "Type", cell: (e) => <span className="mono">{e.type}</span> },
    {
      key: "message",
      header: "Message",
      cell: (e) => (
        <div className={styles.eventRow}>
          <span>{e.message}</span>
          {open === e.id && e.detail !== null && <pre className={styles.code}>{JSON.stringify(e.detail, null, 2)}</pre>}
        </div>
      ),
    },
    {
      key: "match",
      header: "Match",
      hideOnMobile: true,
      cell: (e) =>
        e.matchId ? (
          <Link href={`/admin/matches/${e.matchId}`} className="mono">
            {shortId(e.matchId)}
          </Link>
        ) : (
          "--"
        ),
    },
    {
      key: "detail",
      header: <span className="visually-hidden">Detail</span>,
      align: "right",
      cell: (e) =>
        e.detail !== null ? (
          <Button variant="ghost" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
            {open === e.id ? "Hide" : "Detail"}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Events"
        description="Webhooks from match servers and errors recorded by the api, newest first."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
        actions={
          <Button variant="secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? "Resume live" : "Pause live"}
          </Button>
        }
      />
      <div className={styles.filters}>
        <Select
          label="Show"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          options={[
            { value: "all", label: "Everything" },
            { value: "webhook", label: "Webhooks" },
            { value: "error", label: "Errors" },
            { value: "failed", label: "Errors and rejected webhooks" },
          ]}
        />
        <Select
          label="Limit"
          value={String(limit)}
          onChange={(e) => setLimit(Number(e.target.value))}
          options={[50, 100, 250, 500].map((n) => ({ value: String(n), label: `${n} newest` }))}
        />
      </div>
      {live.error && !live.data ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="events" />
      ) : (
        <Table caption="Recent events" columns={columns} rows={rows} rowKey={(e) => e.id} loading={!live.data} empty="No events." />
      )}
    </>
  );
}
