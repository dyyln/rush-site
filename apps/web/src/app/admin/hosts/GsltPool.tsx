"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { adminApi, errorMessage } from "../_lib/client";
import { ago, shortId } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import type { GsltStatus, GsltView, HostView } from "../_lib/types";
import { ConfirmDialog, ErrorPanel, Section } from "../_components/parts";
import styles from "../admin.module.css";

const STATUS: Record<GsltStatus, { label: string; tone: BadgeTone }> = {
  free: { label: "Free", tone: "win" },
  in_use: { label: "In use", tone: "accent" },
  invalid: { label: "Invalid", tone: "loss" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function GsltPool({ hosts }: { hosts: HostView[] | undefined }) {
  const toast = useToast();
  const now = useNow(30_000);
  const live = useLiveData(() => adminApi.gslt(), [], { kinds: ["host", "match"], pollMs: 30_000 });
  const [removing, setRemoving] = useState<GsltView | null>(null);
  const [editing, setEditing] = useState<GsltView | null>(null);
  const pool = live.data;

  // Each Hetzner slot on an online host needs its own token. DatHost runs without one
  const slots = (hosts ?? []).filter((h) => h.status === "online").reduce((n, h) => n + h.slots.total, 0);
  const usable = pool ? pool.counts.free + pool.counts.inUse : 0;
  const short = pool && hosts ? slots - usable : 0;

  const columns: Column<GsltView>[] = [
    { key: "token", header: "Token", cell: (t) => <span className="mono">{t.token}</span> },
    { key: "memo", header: "Memo", cell: (t) => t.memo ?? <span className={styles.muted}>None</span> },
    {
      key: "status",
      header: "Status",
      skeleton: "chip",
      cell: (t) => <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>,
    },
    {
      key: "match",
      header: "Match",
      hideOnMobile: true,
      cell: (t) =>
        t.matchId ? (
          <Link href={`/admin/matches/${t.matchId}`} className="mono">
            {shortId(t.matchId)}
          </Link>
        ) : null,
    },
    {
      key: "lastUsed",
      header: "Last used",
      hideOnMobile: true,
      cell: (t) =>
        t.lastUsedAt ? (
          <time dateTime={t.lastUsedAt} title={new Date(t.lastUsedAt).toLocaleString("en-GB")} className={styles.nowrap}>
            {ago(t.lastUsedAt, now)}
          </time>
        ) : (
          <span className={styles.muted}>Never</span>
        ),
    },
    {
      key: "added",
      header: "Added",
      hideOnMobile: true,
      cell: (t) => (
        <time dateTime={t.createdAt} title={new Date(t.createdAt).toLocaleString("en-GB")} className={styles.nowrap}>
          {ago(t.createdAt, now)}
        </time>
      ),
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (t) => (
        <span className={styles.actions} style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setEditing(t)} aria-label={`Edit memo of token ${t.token}`}>
            Edit memo
          </Button>
          {t.status !== "in_use" && (
            <Button variant="ghost" onClick={() => setRemoving(t)} aria-label={`Remove token ${t.token}`}>
              Remove
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <Section
      id="gslt"
      title="Game server login tokens"
      actions={
        pool && (
          <span className="mono" aria-label={`${pool.counts.free} free of ${pool.counts.total} tokens`}>
            {pool.counts.free} free / {pool.counts.total}
          </span>
        )
      }
    >
      <p className={styles.muted}>
        Every Hetzner server needs its own token from the Steam account at steamcommunity.com/dev/managegameservers. DatHost surge servers run without one.
      </p>
      {short > 0 && (
        <p className={styles.warnPanel} role="status">
          {plural(slots, "Hetzner slot")} on online hosts but only {plural(usable, "usable token")}. {plural(short, "slot")} cannot start a match
          until more tokens are added.
        </p>
      )}
      <AddTokens
        onAdded={(msg) => {
          toast.push({ title: msg, tone: "success" });
          live.reload();
        }}
      />
      {live.error && !pool ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the token pool" />
      ) : (
        <Table
          caption="Game server login tokens"
          columns={columns}
          rows={pool?.tokens ?? []}
          rowKey={(t) => t.id}
          loading={live.loading}
          empty="No tokens yet. Paste them above."
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove token ${removing?.token ?? ""}?`}
        body={
          <p>
            The token leaves the pool and is not used for new matches. It stays valid on Steam until you delete it there.
            {removing?.memo ? ` Memo: ${removing.memo}.` : ""}
          </p>
        }
        confirmLabel="Remove token"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await adminApi.removeGslt(removing.id);
          toast.push({ title: `Token ${removing.token} removed`, tone: "success" });
          live.reload();
        }}
      />
      <EditMemo
        token={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          live.reload();
        }}
      />
    </Section>
  );
}

function AddTokens({ onAdded }: { onAdded: (message: string) => void }) {
  const textId = useId();
  const [text, setText] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  async function submit() {
    if (!text.trim()) return setError("Paste at least one token");
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const r = await adminApi.addGslt(text, memo.trim() || undefined);
      const parts = [`${plural(r.added, "token")} added`];
      if (r.skipped > 0) parts.push(`${r.skipped} already in the pool`);
      onAdded(parts.join(", "));
      if (r.invalidLines.length > 0) setNote(`No valid token on line ${r.invalidLines.join(", ")}. Those lines were ignored.`);
      setText("");
      setMemo("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add tokens">
      <form
        className={styles.formGrid}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className={styles.formWide}>
          <label className={styles.fieldLabel} htmlFor={textId}>
            Tokens, one per line
          </label>
          <textarea
            id={textId}
            className={`${styles.textarea} ${styles.tokenPaste}`}
            value={text}
            spellCheck={false}
            autoComplete="off"
            placeholder={"730    0123456789ABCDEF0123456789ABCDEF    Never    Duelrush5"}
            aria-describedby={`${textId}-hint`}
            onChange={(e) => {
              setText(e.target.value);
              setError(undefined);
            }}
          />
          <p id={`${textId}-hint`} className={styles.muted}>
            Copy rows from Steam&apos;s manage page or paste bare 32 character tokens. The memo column is kept. Tokens already in the pool are skipped.
          </p>
        </div>
        <Input
          label="Memo (optional)"
          hint="Used for lines without their own memo"
          value={memo}
          maxLength={64}
          onChange={(e) => setMemo(e.target.value)}
        />
        {error && (
          <p role="alert" className={`${styles.loss} ${styles.formWide}`}>
            {error}
          </p>
        )}
        {note && (
          <p role="status" className={`${styles.muted} ${styles.formWide}`}>
            {note}
          </p>
        )}
        <div className={`${styles.actions} ${styles.formWide}`}>
          <Button type="submit" loading={busy}>
            Add tokens
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EditMemo({ token, onClose, onSaved }: { token: GsltView | null; onClose: () => void; onSaved: () => void }) {
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [forId, setForId] = useState<string | null>(null);

  // Load the current memo each time a different token opens
  if (token && token.id !== forId) {
    setForId(token.id);
    setMemo(token.memo ?? "");
    setError(undefined);
  }

  async function save() {
    if (!token) return;
    setBusy(true);
    setError(undefined);
    try {
      await adminApi.updateGslt(token.id, memo.trim() || null);
      onSaved();
      setForId(null);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setForId(null);
    onClose();
  };

  return (
    <Modal
      open={token !== null}
      title={`Memo for ${token?.token ?? ""}`}
      onClose={busy ? undefined : close}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Back
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save memo
          </Button>
        </>
      }
    >
      <div className="stack">
        <Input
          label="Memo"
          hint="Match it to the memo on Steam's manage page. Leave empty to clear it"
          value={memo}
          maxLength={64}
          onChange={(e) => setMemo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void save();
          }}
        />
        {error && (
          <p role="alert" className={styles.loss}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
