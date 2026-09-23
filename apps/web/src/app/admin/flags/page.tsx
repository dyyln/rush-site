"use client";

import { useState } from "react";
import { MODES, queueOpenFlag } from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { adminApi, errorMessage } from "../_lib/client";
import { ago } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import type { FeatureFlag } from "../_lib/types";
import { ConfirmDialog, ErrorPanel, PageHeader } from "../_components/parts";
import styles from "../admin.module.css";

const KEY_RE = /^[a-z0-9][a-z0-9_.-]*$/;
const QUEUE_KEYS = new Set<string>(MODES.map(queueOpenFlag));

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return JSON.stringify(v);
}

export default function AdminFlagsPage() {
  const toast = useToast();
  const now = useNow(30_000);
  const live = useLiveData(() => adminApi.flags(), [], { kinds: ["queue"], pollMs: 30_000 });
  const [removing, setRemoving] = useState<FeatureFlag | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(f: FeatureFlag) {
    setBusy(f.key);
    try {
      await adminApi.setFlag(f.key, !f.enabled);
      live.reload();
    } catch (e) {
      toast.push({ title: "Could not update the flag", body: errorMessage(e), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<FeatureFlag>[] = [
    { key: "key", header: "Key", cell: (f) => <span className="mono">{f.key}</span> },
    {
      key: "state",
      header: "State",
      cell: (f) => <Badge tone={f.enabled ? "win" : "neutral"}>{f.enabled ? "On" : "Off"}</Badge>,
    },
    { key: "value", header: "Value", cell: (f) => <span className="mono">{valueText(f.value) || <span className={styles.muted}>none</span>}</span>, hideOnMobile: true },
    {
      key: "updated",
      header: "Updated",
      cell: (f) => (
        <span className={styles.muted} title={f.updatedBy ?? undefined}>
          {ago(f.updatedAt, now)}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (f) => (
        <div className={styles.actions} style={{ justifyContent: "flex-end" }}>
          <Button variant="secondary" loading={busy === f.key} onClick={() => void toggle(f)}>
            Turn {f.enabled ? "off" : "on"}
          </Button>
          <Button variant="ghost" onClick={() => setRemoving(f)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Switches read by the api and the site. Enabled flags are public at GET /flags. Queue flags open and close modes, use the overview for those."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      <NewFlag onSaved={live.reload} />
      {live.error && !live.data ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the flags" />
      ) : (
        <Table
          caption="Feature flags"
          columns={columns}
          rows={live.data ?? []}
          rowKey={(f) => f.key}
          loading={live.loading}
          empty="No flags yet. Every key is off until it exists."
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Delete ${removing.key}?` : ""}
        body={
          removing && QUEUE_KEYS.has(removing.key)
            ? "Without this flag the queue counts as open."
            : "Code that reads this flag will treat it as off."
        }
        confirmLabel="Delete flag"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await adminApi.deleteFlag(removing.key);
          live.reload();
        }}
      />
    </>
  );
}

function NewFlag({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<{ key?: string; value?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const k = key.trim();
    const errs: typeof error = {};
    if (!KEY_RE.test(k) || k.length > 100) errs.key = "Lowercase letters, digits, dots, dashes and underscores";
    let parsed: unknown = undefined;
    if (value.trim()) {
      try {
        parsed = JSON.parse(value);
      } catch {
        errs.value = "Enter valid JSON, for example 3, \"text\" or {\"max\": 3}";
      }
    }
    setError(errs);
    if (errs.key || errs.value) return;
    setBusy(true);
    try {
      await adminApi.setFlag(k, enabled, parsed);
      toast.push({ title: `Saved ${k}`, tone: "success" });
      setKey("");
      setValue("");
      onSaved();
    } catch (e) {
      toast.push({ title: "Could not save the flag", body: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Set a flag">
      <form
        className={styles.formGrid}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input label="Key" placeholder="cups.weekly" value={key} error={error.key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
        <Input
          label="Value (JSON, optional)"
          placeholder='{"max": 3}'
          value={value}
          error={error.value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <div className={styles.actions}>
          <Button type="submit" loading={busy}>
            Save flag
          </Button>
        </div>
      </form>
    </Card>
  );
}
