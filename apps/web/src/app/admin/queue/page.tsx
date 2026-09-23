"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Table, type Column } from "@/components/ui/Table";
import { TierChip } from "@/components/ui/TierChip";
import { useToast } from "@/components/ui/Toast";
import { MODE_COPY } from "@/lib/modes";
import { adminApi } from "../_lib/client";
import { duration, shortId } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import type { QueueTicketView } from "../_lib/types";
import styles from "../admin.module.css";
import { ConfirmDialog, ErrorPanel, PageHeader, PlayerList, Section } from "../_components/parts";

export default function AdminQueuePage() {
  const live = useLiveData(() => adminApi.queue(), [], { kinds: ["queue", "match"], pollMs: 10_000 });
  const now = useNow();
  const toast = useToast();
  const [target, setTarget] = useState<QueueTicketView | null>(null);

  const columns: Column<QueueTicketView>[] = [
    { key: "party", header: "Party", cell: (t) => <PlayerList players={t.players} /> },
    { key: "size", header: "Size", cell: (t) => t.size, numeric: true, width: "64px", hideOnMobile: true },
    {
      key: "rating",
      header: "Rating",
      cell: (t) => (t.rating === null ? "--" : <TierChip rating={t.rating} size="sm" />),
      numeric: true,
    },
    {
      key: "modes",
      header: "Also queued",
      hideOnMobile: true,
      cell: (t) => (
        <span className="row">
          {t.modes.map((m) => (
            <Badge key={m}>{MODE_COPY[m].short}</Badge>
          ))}
        </span>
      ),
    },
    {
      key: "wait",
      header: "Waiting",
      numeric: true,
      cell: (t) => <span className={styles.nowrap}>{duration((now - Date.parse(t.enqueuedAt)) / 1000)}</span>,
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (t) => (
        <Button variant="danger" onClick={() => setTarget(t)} aria-label={`Remove ticket ${shortId(t.id)} from queue`}>
          Remove
        </Button>
      ),
    },
  ];

  const q = live.data;

  return (
    <>
      <PageHeader
        title="Queue"
        description={
          q ? `${q.totalPlayers} players in ${q.totalTickets} tickets. A ticket shows under every mode it is queued for.` : "Live tickets per mode."
        }
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      {live.error && !q ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the queue" />
      ) : (
        (q?.modes ?? (["aim1v1", "aim2v2", "rush3v3"] as const).map((mode) => ({ mode, players: 0, tickets: [] }))).map((m) => (
          <Section
            key={m.mode}
            id={m.mode}
            title={MODE_COPY[m.mode].label}
            actions={q && <Badge tone={m.players > 0 ? "accent" : "neutral"}>{`${m.players} players`}</Badge>}
          >
            <Table
              caption={`${MODE_COPY[m.mode].label} queue`}
              columns={columns}
              rows={m.tickets}
              rowKey={(t) => t.id}
              loading={!q}
              empty="Nobody queued."
            />
          </Section>
        ))
      )}
      <ConfirmDialog
        open={target !== null}
        title="Remove from queue"
        body={
          target && (
            <p>
              Removes ticket <span className="mono">{shortId(target.id)}</span> ({target.players.map((p) => p.displayName).join(", ")}) from
              every mode. The party is told they left the queue.
            </p>
          )
        }
        confirmLabel="Remove"
        reason="optional"
        danger
        onClose={() => setTarget(null)}
        onConfirm={async (reason) => {
          if (!target) return;
          await adminApi.removeTicket(target.id, reason || undefined);
          toast.push({ title: "Ticket removed", tone: "success" });
          live.reload();
        }}
      />
    </>
  );
}
