"use client";

import { useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { adminApi, errorMessage, type AnnouncementInput } from "../_lib/client";
import { useLiveData, useNow } from "../_lib/live";
import type { Announcement } from "../_lib/types";
import { ConfirmDialog, ErrorPanel, PageHeader } from "../_components/parts";
import styles from "../admin.module.css";

type Phase = "live" | "scheduled" | "ended";

function phaseOf(a: Announcement, now: number): Phase {
  if (Date.parse(a.startsAt) > now) return "scheduled";
  if (a.endsAt && Date.parse(a.endsAt) <= now) return "ended";
  return "live";
}

const PHASE_TONE = { live: "win", scheduled: "info", ended: "neutral" } as const;

// datetime-local works in local time without a zone
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function when(iso: string | null): string {
  if (!iso) return "No end";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

type Draft = { text: string; level: "info" | "warn"; startsAt: string; endsAt: string; dismissible: boolean };

const EMPTY: Draft = { text: "", level: "info", startsAt: "", endsAt: "", dismissible: true };

function draftOf(a: Announcement): Draft {
  return { text: a.text, level: a.level, startsAt: toLocalInput(a.startsAt), endsAt: toLocalInput(a.endsAt), dismissible: a.dismissible };
}

// Validates a draft and turns it into the api body
function inputOf(d: Draft): { input?: AnnouncementInput; error?: string } {
  const text = d.text.trim();
  if (!text) return { error: "Write the announcement text" };
  if (text.length > 500) return { error: "Keep it under 500 characters" };
  const startsAt = fromLocalInput(d.startsAt) ?? undefined;
  const endsAt = fromLocalInput(d.endsAt);
  const start = startsAt ? Date.parse(startsAt) : Date.now();
  if (endsAt && Date.parse(endsAt) <= start) return { error: "The end must be after the start" };
  return { input: { text, level: d.level, dismissible: d.dismissible, endsAt, ...(startsAt ? { startsAt } : {}) } };
}

export default function AdminAnnouncementsPage() {
  const toast = useToast();
  const now = useNow(15_000);
  const live = useLiveData(() => adminApi.announcements(), [], { kinds: [], pollMs: 30_000 });
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [removing, setRemoving] = useState<Announcement | null>(null);

  async function endNow(a: Announcement) {
    try {
      const start = Date.parse(a.startsAt);
      // A scheduled one that never ran gets its start pulled back so the window stays valid
      const at = new Date().toISOString();
      await adminApi.updateAnnouncement(a.id, start > Date.now() ? { startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: at } : { endsAt: at });
      live.reload();
    } catch (e) {
      toast.push({ title: "Could not end the announcement", body: errorMessage(e), tone: "error" });
    }
  }

  const columns: Column<Announcement>[] = [
    {
      key: "state",
      header: "State",
      cell: (a) => {
        const p = phaseOf(a, now);
        return <Badge tone={PHASE_TONE[p]}>{p}</Badge>;
      },
    },
    {
      key: "text",
      header: "Text",
      cell: (a) => (
        <span>
          {a.level === "warn" && <Badge tone="warn">warn</Badge>} {a.text}
        </span>
      ),
    },
    {
      key: "window",
      header: "Window",
      hideOnMobile: true,
      cell: (a) => (
        <span className={`${styles.muted} ${styles.nowrap}`}>
          {when(a.startsAt)} to {when(a.endsAt)}
        </span>
      ),
    },
    { key: "dismiss", header: "Dismissible", hideOnMobile: true, cell: (a) => (a.dismissible ? "Yes" : "No") },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (a) => (
        <div className={styles.actions} style={{ justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={() => setEditing(a)}>
            Edit
          </Button>
          {phaseOf(a, now) !== "ended" && (
            <Button variant="ghost" onClick={() => void endNow(a)}>
              End now
            </Button>
          )}
          <Button variant="ghost" onClick={() => setRemoving(a)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Announcements"
        description="A banner across the top of every page while inside its window. Players can hide dismissible ones."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      <Card title="New announcement">
        <AnnouncementForm
          initial={EMPTY}
          submitLabel="Publish"
          onSubmit={async (input) => {
            await adminApi.createAnnouncement(input);
            toast.push({ title: "Announcement saved", tone: "success" });
            live.reload();
          }}
          resetOnSave
        />
      </Card>
      {live.error && !live.data ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the announcements" />
      ) : (
        <Table
          caption="Announcements"
          columns={columns}
          rows={live.data ?? []}
          rowKey={(a) => a.id}
          loading={live.loading}
          highlight={(a) => phaseOf(a, now) === "live"}
          empty="No announcements yet"
        />
      )}
      <Modal open={editing !== null} title="Edit announcement" onClose={() => setEditing(null)} size="md">
        {editing && (
          <AnnouncementForm
            key={editing.id}
            initial={draftOf(editing)}
            submitLabel="Save changes"
            onSubmit={async (input) => {
              await adminApi.updateAnnouncement(editing.id, { ...input, startsAt: input.startsAt ?? editing.startsAt });
              setEditing(null);
              live.reload();
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Delete this announcement?"
        body={removing?.text}
        confirmLabel="Delete"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await adminApi.deleteAnnouncement(removing.id);
          live.reload();
        }}
      />
    </>
  );
}

function AnnouncementForm({
  initial,
  submitLabel,
  onSubmit,
  resetOnSave,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (input: AnnouncementInput) => Promise<void>;
  resetOnSave?: boolean;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const textId = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function submit() {
    const r = inputOf(d);
    if (!r.input) return setError(r.error);
    setError(undefined);
    setBusy(true);
    try {
      await onSubmit(r.input);
      if (resetOnSave) setD(EMPTY);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.formGrid}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={styles.formWide}>
        <label className={styles.fieldLabel} htmlFor={textId}>
          Text
        </label>
        <textarea id={textId} className={styles.textarea} maxLength={500} value={d.text} onChange={(e) => set("text", e.target.value)} />
      </div>
      <Select
        label="Level"
        value={d.level}
        onChange={(e) => set("level", e.target.value as Draft["level"])}
        options={[
          { value: "info", label: "Info" },
          { value: "warn", label: "Warning" },
        ]}
      />
      <label className={styles.check}>
        <input type="checkbox" checked={d.dismissible} onChange={(e) => set("dismissible", e.target.checked)} />
        Players can dismiss it
      </label>
      <Input label="Starts (blank for now)" type="datetime-local" value={d.startsAt} onChange={(e) => set("startsAt", e.target.value)} hint="Your local time" />
      <Input label="Ends (blank for no end)" type="datetime-local" value={d.endsAt} onChange={(e) => set("endsAt", e.target.value)} hint="Your local time" />
      {error && (
        <p role="alert" className={`${styles.loss} ${styles.formWide}`}>
          {error}
        </p>
      )}
      <div className={`${styles.actions} ${styles.formWide}`}>
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
