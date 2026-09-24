"use client";

import Link from "next/link";
import { useState } from "react";
import {
  MODES,
  type OpenCupOutcome,
  type CupSchedule,
  type CupScheduleCadence,
  type CupSchedulePatch,
  type Mode,
  type TrustLevel,
} from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import { entryName, roundName } from "@/components/ui/BracketView";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { dateTime } from "@/lib/format";
import { MODE_COPY } from "@/lib/modes";
import { STATUS_LABEL } from "@/lib/tournaments";
import type { BracketMatch, EntryView, TournamentDetail, TournamentSummary } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { ConfirmDialog, ErrorPanel, PageHeader, Section } from "../_components/parts";
import { errorMessage } from "../_lib/client";
import { useLiveData } from "../_lib/live";
import styles from "../admin.module.css";
import { cupsApi } from "./client";
import cs from "./cups.module.css";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TRUST: TrustLevel[] = ["new", "verified", "trusted"];
const MODE_OPTIONS = MODES.map((m) => ({ value: m, label: MODE_COPY[m].label }));
const TRUST_OPTIONS = TRUST.map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }));
const BO_OPTIONS = [1, 3, 5].map((n) => ({ value: String(n), label: `Bo${n}` }));
const OPEN_MATCH = new Set(["ready", "provisioning", "live"]);

function when(s: CupSchedule): string {
  return s.cadence === "weekly" ? `${WEEKDAYS[s.weekday ?? 0]} ${s.startTime} UTC` : `Daily ${s.startTime} UTC`;
}

// Value for a datetime-local input, read and written as UTC
function utcInput(iso: string): string {
  return iso.slice(0, 16);
}
function fromUtcInput(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return `${v}:00.000Z`;
}

export default function AdminTournamentsPage() {
  const toast = useToast();
  const schedules = useLiveData(() => cupsApi.schedules(), [], { kinds: [], pollMs: 60_000 });
  const cups = useLiveData(() => cupsApi.active(), [], { kinds: ["match"], pollMs: 15_000 });
  const done = useLiveData(() => cupsApi.completed(), [], { kinds: [], pollMs: 120_000 });
  const [editing, setEditing] = useState<CupSchedule | "new" | null>(null);
  const [deleting, setDeleting] = useState<CupSchedule | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<TournamentSummary | null>(null);
  const [moving, setMoving] = useState<TournamentSummary | null>(null);

  function openCupNote(o: OpenCupOutcome | null): string | undefined {
    if (!o) return undefined;
    if (o.action === "cancelled") return `Its open cup had no entries and was cancelled.`;
    return `Its open cup ${o.name} has ${o.entrantCount} ${o.entrantCount === 1 ? "entry" : "entries"} and stays. Cancel it below if needed.`;
  }

  async function toggle(s: CupSchedule) {
    setToggling(s.id);
    try {
      const { openCup } = await cupsApi.updateSchedule(s.id, { enabled: !s.enabled });
      toast.push({ title: `${s.name} ${s.enabled ? "disabled" : "enabled"}`, body: openCupNote(openCup), tone: openCup?.action === "kept" ? "info" : "success" });
      schedules.reload();
      cups.reload();
    } catch (e) {
      toast.push({ title: "Could not update schedule", body: errorMessage(e), tone: "error" });
    } finally {
      setToggling(null);
    }
  }

  const scheduleColumns: Column<CupSchedule>[] = [
    {
      key: "name",
      header: "Cup",
      cell: (s) => (
        <span className="stack" style={{ gap: 0 }}>
          <span>{s.name}</span>
          <span className={`${styles.muted} mono`}>{s.cupKey}</span>
        </span>
      ),
    },
    { key: "mode", header: "Mode", cell: (s) => MODE_COPY[s.mode].label },
    { key: "when", header: "When", cell: (s) => <span className={styles.nowrap}>{when(s)}</span> },
    { key: "max", header: "Max", numeric: true, hideOnMobile: true, cell: (s) => <span className="mono">{s.maxEntrants}</span> },
    { key: "trust", header: "Trust", hideOnMobile: true, cell: (s) => s.minTrust },
    { key: "final", header: "Final", hideOnMobile: true, cell: (s) => `Bo${s.bestOfFinal}` },
    {
      key: "next",
      header: "Next start",
      hideOnMobile: true,
      cell: (s) => (s.nextStartsAt ? <span className={styles.nowrap}>{dateTime(s.nextStartsAt)}</span> : <span className={styles.muted}>Off</span>),
    },
    {
      key: "enabled",
      header: "Enabled",
      cell: (s) => (
        <button
          type="button"
          role="switch"
          aria-checked={s.enabled}
          aria-label={`${s.name} enabled`}
          className={cs.switch}
          disabled={toggling === s.id}
          onClick={() => toggle(s)}
        >
          <span className={cs.track} aria-hidden="true" />
          {s.enabled ? "On" : "Off"}
        </button>
      ),
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (s) => (
        <span className={cs.actions}>
          <Button variant="secondary" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(s)} aria-label={`Delete ${s.name}`}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  const cupColumns: Column<TournamentSummary>[] = [
    {
      key: "name",
      header: "Cup",
      cell: (t) => (
        <span className="stack" style={{ gap: 0 }}>
          <Link href={`/tournaments/${t.id}`}>{t.name}</Link>
          <span className={styles.muted}>
            {MODE_COPY[t.mode].label}, {t.cadence}
          </span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (t) => <Badge tone={STATUS_LABEL[t.status].tone}>{STATUS_LABEL[t.status].label}</Badge> },
    { key: "starts", header: "Starts", hideOnMobile: true, cell: (t) => <span className={styles.nowrap}>{dateTime(t.startsAt)}</span> },
    { key: "entrants", header: "Entrants", numeric: true, cell: (t) => <span className="mono">{`${t.entrantCount}/${t.maxEntrants}`}</span> },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (t) => (
        <span className={cs.actions}>
          <Button
            variant={managing === t.id ? "primary" : "secondary"}
            aria-expanded={managing === t.id}
            aria-controls="cup-tools"
            onClick={() => setManaging(managing === t.id ? null : t.id)}
          >
            {managing === t.id ? "Close" : "Manage"}
          </Button>
          {t.status === "open" && (
            <Button variant="secondary" onClick={() => setMoving(t)} aria-label={`Reschedule ${t.name}`}>
              Reschedule
            </Button>
          )}
          <Button variant="danger" onClick={() => setCancelling(t)} aria-label={`Cancel ${t.name}`}>
            Cancel
          </Button>
        </span>
      ),
    },
  ];

  const managed = cups.data?.find((t) => t.id === managing);
  const finished = done.data?.find((t) => t.id === managing);

  return (
    <>
      <PageHeader
        title="Tournaments"
        description="Recurring cup schedules, one-off cups, and tools for cups that are open or running. Times are UTC."
        updatedAt={cups.updatedAt}
        refreshing={cups.refreshing || schedules.refreshing}
        onRefresh={() => {
          schedules.reload();
          cups.reload();
        }}
      />

      <Section
        title="Schedules"
        actions={
          <Button variant="secondary" onClick={() => setEditing("new")}>
            New schedule
          </Button>
        }
      >
        {schedules.error && !schedules.data ? (
          <ErrorPanel error={schedules.error} onRetry={schedules.reload} what="schedules" />
        ) : (
          <Table
            caption="Cup schedules"
            columns={scheduleColumns}
            rows={schedules.data ?? []}
            rowKey={(s) => s.id}
            loading={!schedules.data}
            empty="No schedules. Recurring cups will not be created."
          />
        )}
      </Section>

      <Section title="Open and running cups">
        {cups.error && !cups.data ? (
          <ErrorPanel error={cups.error} onRetry={cups.reload} what="cups" />
        ) : (
          <Table
            caption="Open and running cups"
            columns={cupColumns}
            rows={cups.data ?? []}
            rowKey={(t) => t.id}
            loading={!cups.data}
            empty="No cups are open or running."
          />
        )}
        {managed && <CupTools key={managed.id} cup={managed} onChanged={cups.reload} />}
      </Section>

      <Section title="Recently completed">
        {done.error && !done.data ? (
          <ErrorPanel error={done.error} onRetry={done.reload} what="completed cups" />
        ) : (
          <Table
            caption="Recently completed cups"
            columns={[cupColumns[0]!, cupColumns[2]!, cupColumns[3]!, cupColumns[4]!].map((c) =>
              c.key === "actions"
                ? {
                    ...c,
                    cell: (t: TournamentSummary) => (
                      <Button
                        variant={managing === t.id ? "primary" : "secondary"}
                        aria-expanded={managing === t.id}
                        onClick={() => setManaging(managing === t.id ? null : t.id)}
                      >
                        {managing === t.id ? "Close" : "Badges"}
                      </Button>
                    ),
                  }
                : c,
            )}
            rows={done.data ?? []}
            rowKey={(t) => t.id}
            loading={!done.data}
            empty="No completed cups yet."
          />
        )}
        {finished && <CupTools key={finished.id} cup={finished} onChanged={done.reload} />}
      </Section>

      <Section title="Create a one-off cup">
        <CreateCupForm
          onCreated={(t) => {
            toast.push({ title: `${t.name} created`, tone: "success" });
            cups.reload();
          }}
        />
      </Section>

      <ScheduleDialog
        schedule={editing}
        onClose={() => setEditing(null)}
        onSaved={(s, created) => {
          toast.push({ title: created ? `${s.name} added` : `${s.name} saved`, tone: "success" });
          schedules.reload();
          cups.reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete schedule"
        body={
          deleting && (
            <p>
              Stops creating <strong>{deleting.name}</strong> ({when(deleting)}). If its open cup has no entries it is cancelled,
              otherwise it stays and you can cancel it separately.
            </p>
          )
        }
        confirmLabel="Delete schedule"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const openCup = await cupsApi.deleteSchedule(deleting.id);
          toast.push({ title: "Schedule deleted", body: openCupNote(openCup), tone: openCup?.action === "kept" ? "info" : "success" });
          schedules.reload();
          cups.reload();
        }}
      />
      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel cup"
        body={
          cancelling && (
            <p>
              Cancels <strong>{cancelling.name}</strong> ({STATUS_LABEL[cancelling.status].label.toLowerCase()}, {cancelling.entrantCount}{" "}
              entrants). Live games are stopped and no badges are awarded. This cannot be undone.
            </p>
          )
        }
        confirmLabel="Cancel cup"
        reason="required"
        danger
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          await cupsApi.cancel(cancelling.id, reason);
          if (managing === cancelling.id) setManaging(null);
          toast.push({ title: "Cup cancelled", tone: "success" });
          cups.reload();
        }}
      />
      <RescheduleDialog cup={moving} onClose={() => setMoving(null)} onDone={cups.reload} />
    </>
  );
}

function ScheduleDialog({
  schedule,
  onClose,
  onSaved,
}: {
  schedule: CupSchedule | "new" | null;
  onClose: () => void;
  onSaved: (s: CupSchedule, created: boolean) => void;
}) {
  const open = schedule !== null;
  const initial = schedule && schedule !== "new" ? schedule : null;
  return (
    <Modal open={open} title={initial ? `Edit ${initial.name}` : "New schedule"} onClose={onClose} size="md">
      {open && <ScheduleForm key={initial?.id ?? "new"} initial={initial} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function ScheduleForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: CupSchedule | null;
  onClose: () => void;
  onSaved: (s: CupSchedule, created: boolean) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "rush3v3");
  const [cadence, setCadence] = useState<CupScheduleCadence>(initial?.cadence ?? "daily");
  const [weekday, setWeekday] = useState(initial?.weekday ?? 0);
  const [startTime, setStartTime] = useState(initial?.startTime ?? "18:00");
  const [maxEntrants, setMaxEntrants] = useState(String(initial?.maxEntrants ?? 16));
  const [minTrust, setMinTrust] = useState<TrustLevel>(initial?.minTrust ?? "verified");
  const [bestOfFinal, setBestOfFinal] = useState<1 | 3 | 5>(initial?.bestOfFinal ?? 3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    const max = Number(maxEntrants);
    if (!Number.isInteger(max) || max < 2 || max > 128) {
      setError("Max entrants must be between 2 and 128");
      return;
    }
    if (name.trim() && name.trim().length < 3) {
      setError("Name needs at least 3 characters");
      return;
    }
    setBusy(true);
    setError(undefined);
    const fields = {
      mode,
      cadence,
      weekday: cadence === "weekly" ? weekday : null,
      startTime,
      maxEntrants: max,
      minTrust,
      bestOfFinal,
      ...(name.trim() ? { name: name.trim() } : {}),
    };
    try {
      if (initial) {
        const patch: CupSchedulePatch = fields;
        onSaved((await cupsApi.updateSchedule(initial.id, patch)).schedule, false);
      } else {
        onSaved(await cupsApi.createSchedule(fields), true);
      }
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={cs.form}>
        <Input
          className={cs.formWide}
          label="Name"
          value={name}
          maxLength={60}
          placeholder="Generated from mode and cadence when empty"
          onChange={(e) => setName(e.target.value)}
        />
        <Select label="Mode" options={MODE_OPTIONS} value={mode} onChange={(e) => setMode(e.target.value as Mode)} />
        <Select
          label="Cadence"
          options={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ]}
          value={cadence}
          onChange={(e) => setCadence(e.target.value as CupScheduleCadence)}
        />
        {cadence === "weekly" && (
          <Select
            label="Weekday (UTC)"
            options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
            value={String(weekday)}
            onChange={(e) => setWeekday(Number(e.target.value))}
          />
        )}
        <Input label="Start (UTC)" type="time" value={startTime} required onChange={(e) => setStartTime(e.target.value)} />
        <Input label="Max entrants" type="number" min={2} max={128} value={maxEntrants} onChange={(e) => setMaxEntrants(e.target.value)} />
        <Select label="Min trust" options={TRUST_OPTIONS} value={minTrust} onChange={(e) => setMinTrust(e.target.value as TrustLevel)} />
        <Select
          label="Final"
          options={BO_OPTIONS}
          value={String(bestOfFinal)}
          onChange={(e) => setBestOfFinal(Number(e.target.value) as 1 | 3 | 5)}
        />
      </div>
      {initial && <p className={styles.muted}>Changes also apply to the cup this schedule has open. A new time moves it to the next slot.</p>}
      {error && (
        <p role="alert" className={styles.loss}>
          {error}
        </p>
      )}
      <div className={cs.actions}>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Back
        </Button>
        <Button type="submit" loading={busy}>
          {initial ? "Save schedule" : "Add schedule"}
        </Button>
      </div>
    </form>
  );
}

function CreateCupForm({ onCreated }: { onCreated: (t: TournamentSummary) => void }) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("rush3v3");
  const [startsAt, setStartsAt] = useState("");
  const [maxEntrants, setMaxEntrants] = useState("16");
  const [minTrust, setMinTrust] = useState<TrustLevel>("verified");
  const [bestOfFinal, setBestOfFinal] = useState<1 | 3 | 5>(3);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const iso = fromUtcInput(startsAt);
  const max = Number(maxEntrants);

  function check(): boolean {
    if (name.trim().length < 3) setError("Name needs at least 3 characters");
    else if (!iso) setError("Pick a start date and time");
    else if (Date.parse(iso) <= Date.now() + 60_000) setError("Start must be in the future");
    else if (!Number.isInteger(max) || max < 2 || max > 128) setError("Max entrants must be between 2 and 128");
    else {
      setError(undefined);
      return true;
    }
    return false;
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (check()) setConfirming(true);
      }}
    >
      <div className={cs.form}>
        <Input label="Name" value={name} maxLength={60} placeholder="Launch Night Cup" onChange={(e) => setName(e.target.value)} />
        <Select label="Mode" options={MODE_OPTIONS} value={mode} onChange={(e) => setMode(e.target.value as Mode)} />
        <Input label="Starts (UTC)" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        <Input label="Max entrants" type="number" min={2} max={128} value={maxEntrants} onChange={(e) => setMaxEntrants(e.target.value)} />
        <Select label="Min trust" options={TRUST_OPTIONS} value={minTrust} onChange={(e) => setMinTrust(e.target.value as TrustLevel)} />
        <Select
          label="Final"
          options={BO_OPTIONS}
          value={String(bestOfFinal)}
          onChange={(e) => setBestOfFinal(Number(e.target.value) as 1 | 3 | 5)}
        />
      </div>
      {error && (
        <p role="alert" className={styles.loss}>
          {error}
        </p>
      )}
      <div className={cs.actions}>
        <Button type="submit">Create cup</Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Create cup"
        body={
          iso && (
            <p>
              Creates <strong>{name.trim()}</strong>, {MODE_COPY[mode].label}, starting {dateTime(iso)} with up to {max} entrants and{" "}
              {minTrust} trust required. Sign-ups open straight away and every player sees it on the tournaments page.
            </p>
          )
        }
        confirmLabel="Create cup"
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          if (!iso) return;
          const t = await cupsApi.createCup({ mode, name: name.trim(), startsAt: iso, maxEntrants: max, minTrust, bestOfFinal });
          setName("");
          setStartsAt("");
          onCreated(t);
        }}
      />
    </form>
  );
}

function RescheduleDialog({ cup, onClose, onDone }: { cup: TournamentSummary | null; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (cup && shownFor !== cup.id) {
    setShownFor(cup.id);
    setValue(utcInput(cup.startsAt));
  }
  return (
    <ConfirmDialog
      open={cup !== null}
      title="Reschedule cup"
      body={
        cup && (
          <div className="stack">
            <p>
              Moves <strong>{cup.name}</strong> from {dateTime(cup.startsAt)}. Entries stay. Players see the new time straight away.
            </p>
            <Input label="New start (UTC)" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        )
      }
      confirmLabel="Reschedule"
      reason="optional"
      onClose={() => {
        setShownFor(null);
        onClose();
      }}
      onConfirm={async () => {
        if (!cup) return;
        const iso = fromUtcInput(value);
        if (!iso) throw new Error("Pick a date and time");
        await cupsApi.reschedule(cup.id, iso);
        setShownFor(null);
        onDone();
      }}
    />
  );
}

function CupTools({ cup, onChanged }: { cup: TournamentSummary; onChanged: () => void }) {
  const toast = useToast();
  const detail = useAsync(() => cupsApi.detail(cup.id), [cup.id]);
  const [dq, setDq] = useState<EntryView | null>(null);
  const [stripping, setStripping] = useState<EntryView | null>(null);
  const [forcing, setForcing] = useState<BracketMatch | null>(null);
  const [winner, setWinner] = useState<string | null>(null);

  const refresh = () => {
    detail.reload();
    onChanged();
  };

  if (detail.status === "loading") return <p className={styles.muted}>Loading cup</p>;
  if (detail.status === "error") return <ErrorPanel error={detail.error} onRetry={detail.reload} what="the cup" />;
  const t: TournamentDetail = detail.data;
  const byId = new Map(t.entries.map((e) => [e.id, e]));
  const openMatches = (t.bracket?.matches ?? []).filter((m) => OPEN_MATCH.has(m.status) && m.a && m.b);

  return (
    <Card as="div" tone="flat" padded={false} id="cup-tools" className={cs.panel} aria-label={`Tools for ${t.name}`} role="region">
      <h3>{t.name}</h3>
      {t.bracket && (
        <section className="stack" aria-label="Open series">
          <h4 className="eyebrow">Open series</h4>
          {openMatches.length === 0 ? (
            <p className={styles.muted}>No series waiting for a result.</p>
          ) : (
            <ul className={cs.list}>
              {openMatches.map((m) => (
                <li key={m.id} className={cs.item}>
                  <span className={cs.itemMain}>
                    <span>
                      {entryName(byId.get(m.a!))} <span className={styles.muted}>vs</span> {entryName(byId.get(m.b!))}
                    </span>
                    <span className={styles.muted}>
                      {roundName(m.round, t.bracket!.rounds)}, Bo{m.bestOf}, {m.status}
                      {m.games.length > 0 && `, ${m.games.filter((g) => g.winner === "a").length}-${m.games.filter((g) => g.winner === "b").length}`}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setWinner(null);
                      setForcing(m);
                    }}
                  >
                    Force result
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="stack" aria-label="Entries">
        <h4 className="eyebrow">Entries</h4>
        {t.entries.length === 0 ? (
          <p className={styles.muted}>No entries yet.</p>
        ) : (
          <ul className={cs.list}>
            {t.entries.map((e) => (
              <li key={e.id} className={cs.item}>
                <span className={cs.itemMain}>
                  <span className={e.disqualified ? cs.struck : undefined}>
                    {e.seed !== null && <span className="mono">#{e.seed} </span>}
                    {entryName(e)}
                  </span>
                  {(e.players?.length ?? 0) > 1 && <span className={styles.muted}>{e.players!.map((p) => p.displayName).join(", ")}</span>}
                </span>
                {t.status === "completed" ? (
                  <Button variant="danger" onClick={() => setStripping(e)} aria-label={`Strip badges from ${entryName(e)}`}>
                    Strip badges
                  </Button>
                ) : e.disqualified ? (
                  <Badge tone="loss">Disqualified</Badge>
                ) : (
                  <Button variant="danger" onClick={() => setDq(e)} aria-label={`Disqualify ${entryName(e)}`}>
                    Disqualify
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={dq !== null}
        title="Disqualify entry"
        body={
          dq && (
            <p>
              Disqualifies <strong>{entryName(dq)}</strong> from {t.name}.{" "}
              {t.status === "running"
                ? "Their current series is awarded to the opponent and any live game is stopped."
                : "They stay listed as disqualified and cannot enter this cup again."}
            </p>
          )
        }
        confirmLabel="Disqualify"
        reason="required"
        danger
        onClose={() => setDq(null)}
        onConfirm={async (reason) => {
          if (!dq) return;
          await cupsApi.disqualify(t.id, dq.id, reason);
          toast.push({ title: `${entryName(dq)} disqualified`, tone: "success" });
          refresh();
        }}
      />
      <ConfirmDialog
        open={stripping !== null}
        title="Strip badges"
        body={
          stripping && (
            <p>
              Removes every badge <strong>{entryName(stripping)}</strong> earned in {t.name} from{" "}
              {stripping.steamIds.length === 1 ? "that player's profile" : `all ${stripping.steamIds.length} players' profiles`}. The
              bracket result stays as played.
            </p>
          )
        }
        confirmLabel="Strip badges"
        reason="required"
        danger
        onClose={() => setStripping(null)}
        onConfirm={async (reason) => {
          if (!stripping) return;
          const res = await cupsApi.stripBadges(t.id, stripping.id, reason);
          toast.push({ title: `${res.removed} ${res.removed === 1 ? "badge" : "badges"} removed`, tone: "success" });
          refresh();
        }}
      />
      <ConfirmDialog
        open={forcing !== null}
        title="Force result"
        body={
          forcing && (
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>
                Pick the series winner for {roundName(forcing.round, t.bracket!.rounds)}. The winner advances and any live game is
                stopped.
              </legend>
              {[forcing.a!, forcing.b!].map((entryId) => (
                <label key={entryId} className={cs.choice}>
                  <input type="radio" name="winner" value={entryId} checked={winner === entryId} onChange={() => setWinner(entryId)} />
                  {entryName(byId.get(entryId))}
                </label>
              ))}
            </fieldset>
          )
        }
        confirmLabel="Set winner"
        reason="required"
        onClose={() => setForcing(null)}
        onConfirm={async (reason) => {
          if (!forcing) return;
          if (!winner) throw new Error("Pick a winner");
          await cupsApi.forceResult(t.id, forcing.id, winner, reason);
          toast.push({ title: `${entryName(byId.get(winner))} advances`, tone: "success" });
          refresh();
        }}
      />
    </Card>
  );
}
