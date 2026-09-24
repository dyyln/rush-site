"use client";

import { useState } from "react";
import {
  LOADOUT_PRIMARIES,
  LOADOUT_SECONDARIES,
  POOL_MAP_ID_RE,
  POOL_MODES,
  type MapLoadout,
  type PoolMap,
  type PoolMode,
  type PoolView,
} from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { MapThumb } from "@/components/play/MapThumb";
import { loadMapPool } from "@/lib/mapPool";
import { MODE_COPY } from "@/lib/modes";
import { adminApi, errorMessage } from "../_lib/client";
import { ago } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import type { WorkshopPreview } from "../_lib/types";
import { ConfirmDialog, ErrorPanel, PageHeader, Section } from "../_components/parts";
import styles from "../admin.module.css";
import local from "./maps.module.css";

const weaponLabel = (w: string) => w.replace(/^weapon_/, "");
const EMPTY = "";
const primaryOptions = [{ value: EMPTY, label: "Empty" }, ...LOADOUT_PRIMARIES.map((w) => ({ value: w, label: weaponLabel(w) }))];
const secondaryOptions = [{ value: EMPTY, label: "Empty" }, ...LOADOUT_SECONDARIES.map((w) => ({ value: w, label: weaponLabel(w) }))];
const ARMOR = [
  { value: "kevlar_helmet", label: "Kevlar and helmet" },
  { value: "kevlar", label: "Kevlar" },
  { value: "none", label: "None" },
];

function loadoutText(l: MapLoadout | null): string {
  if (!l) return "Plugin default";
  const side = (p?: { ct?: string; t?: string }) => {
    if (!p || (!p.ct && !p.t)) return null;
    const ct = p.ct ? weaponLabel(p.ct) : "none";
    const t = p.t ? weaponLabel(p.t) : "none";
    return ct === t ? ct : `${ct} / ${t}`;
  };
  return [side(l.primary), side(l.secondary)].filter(Boolean).join(", ") || "Knife only";
}

function enabledCount(maps: PoolMap[], mode: PoolMode) {
  return maps.filter((m) => m.modes.includes(mode)).length;
}

export default function AdminMapsPage() {
  const toast = useToast();
  const now = useNow(30_000);
  const live = useLiveData(() => adminApi.maps(), [], { kinds: ["maps"], pollMs: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<PoolMap | null>(null);
  const [removing, setRemoving] = useState<PoolMap | null>(null);
  const view = live.data;
  const maps = view?.maps ?? [];

  function changed() {
    live.reload();
    void loadMapPool(true);
  }

  async function run(key: string, what: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      changed();
    } catch (e) {
      toast.push({ title: what, body: errorMessage(e), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  function toggle(m: PoolMap, mode: PoolMode) {
    const modes = m.modes.includes(mode) ? m.modes.filter((x) => x !== mode) : [...m.modes, mode];
    void run(`${m.id}:${mode}`, `Could not update ${m.displayName}`, () => adminApi.updateMap(m.id, { modes }));
  }

  function move(index: number, by: -1 | 1) {
    const ids = maps.map((m) => m.id);
    const j = index + by;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void run(`move:${ids[j]}`, "Could not reorder", () => adminApi.reorderMaps(ids));
  }

  const columns: Column<PoolMap>[] = [
    {
      key: "order",
      header: <span className="visually-hidden">Order</span>,
      cell: (m, i) => (
        <div className={local.order}>
          <Button variant="ghost" aria-label={`Move ${m.displayName} up`} disabled={i === 0 || busy !== null} onClick={() => move(i, -1)}>
            Up
          </Button>
          <Button
            variant="ghost"
            aria-label={`Move ${m.displayName} down`}
            disabled={i === maps.length - 1 || busy !== null}
            onClick={() => move(i, 1)}
          >
            Down
          </Button>
        </div>
      ),
    },
    {
      key: "map",
      header: "Map",
      cell: (m) => (
        <div className={local.mapCell}>
          <MapThumb mapId={m.id} className={local.thumb} dim={m.modes.length === 0} />
          <div className={local.mapText}>
            <strong>{m.displayName}</strong>
            <span className={`${styles.muted} mono`}>{m.id}</span>
            {m.workshopId && (
              <a href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId}`} target="_blank" rel="noreferrer noopener" className="mono">
                Workshop {m.workshopId}
              </a>
            )}
          </div>
        </div>
      ),
    },
    ...POOL_MODES.map(
      (mode): Column<PoolMap> => ({
        key: mode,
        header: MODE_COPY[mode].label,
        cell: (m) => {
          const on = m.modes.includes(mode);
          const atMin = on && view ? enabledCount(maps, mode) <= view.minPool[mode] : false;
          return (
            <label className={styles.check} title={atMin ? `${MODE_COPY[mode].label} needs at least ${view?.minPool[mode]} maps` : undefined}>
              <input
                type="checkbox"
                checked={on}
                disabled={atMin || busy !== null}
                onChange={() => toggle(m, mode)}
                aria-label={`${m.displayName} in ${MODE_COPY[mode].label}`}
              />
              {on ? "On" : "Off"}
            </label>
          );
        },
      }),
    ),
    { key: "loadout", header: "Loadout", cell: (m) => <span className="mono">{loadoutText(m.loadout)}</span>, hideOnMobile: true },
    {
      key: "source",
      header: "Source",
      cell: (m) => (
        <span className={styles.muted} title={m.updatedBy ?? undefined}>
          {m.source === "admin" ? "Admin" : "Config"}
          {m.updatedAt ? `, ${ago(m.updatedAt, now)}` : ""}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (m) => (
        <div className={styles.actions} style={{ justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={() => setEditing(m)}>
            Edit
          </Button>
          {m.source === "admin" && m.modes.length === 0 && (
            <Button variant="ghost" onClick={() => setRemoving(m)}>
              Remove
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Map pool"
        description="Workshop maps for 1v1 and 2v2 Aim. The veto and new servers use this list. Rush always plays rush_001 and is not edited here."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      {view && <PoolSummary view={view} />}
      <AddMap onAdded={changed} />
      <Section title="Maps">
        {live.error && !view ? (
          <ErrorPanel error={live.error} onRetry={live.reload} what="the map pool" />
        ) : (
          <Table caption="Map pool" columns={columns} rows={maps} rowKey={(m) => m.id} loading={live.loading} empty="No maps." />
        )}
      </Section>
      {editing && (
        <EditMap
          map={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove ${removing.displayName}?` : ""}
        body="The map leaves the pool list. Past matches keep their map id. Add it again from the Workshop to bring it back."
        confirmLabel="Remove map"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await adminApi.removeMap(removing.id);
          changed();
        }}
      />
    </>
  );
}

function PoolSummary({ view }: { view: PoolView }) {
  return (
    <div className={local.summary}>
      {POOL_MODES.map((mode) => {
        const n = enabledCount(view.maps, mode);
        const min = view.minPool[mode];
        return (
          <p key={mode} className={local.summaryItem}>
            <span>{MODE_COPY[mode].label}</span>
            <span className="mono">{n} enabled</span>
            <Badge tone={n > min ? "neutral" : "warn"}>min {min}</Badge>
          </p>
        );
      })}
      {!view.stored && <p className={styles.muted}>Showing the shared config defaults. The first change copies them into the database.</p>}
    </div>
  );
}

function LoadoutFields({ value, onChange }: { value: MapLoadout | null; onChange: (l: MapLoadout | null) => void }) {
  const custom = value !== null;
  const l = value ?? {};
  const pick = (slot: "primary" | "secondary", side: "ct" | "t", w: string) => {
    const pair = { ...(l[slot] ?? {}) };
    if (w) pair[side] = w;
    else delete pair[side];
    const next: MapLoadout = { ...l };
    if (pair.ct || pair.t) next[slot] = pair;
    else delete next[slot];
    onChange(next);
  };
  return (
    <fieldset className={local.loadout}>
      <legend className={styles.fieldLabel}>Loadout</legend>
      <label className={styles.check}>
        <input type="checkbox" checked={custom} onChange={(e) => onChange(e.target.checked ? { armor: "kevlar_helmet" } : null)} />
        Custom loadout
      </label>
      {!custom ? (
        <p className={styles.muted}>The plugin picks one by map id, rifles when it does not know the map.</p>
      ) : (
        <div className={styles.formGrid}>
          <Select label="Primary CT" options={primaryOptions} value={l.primary?.ct ?? EMPTY} onChange={(e) => pick("primary", "ct", e.target.value)} />
          <Select label="Primary T" options={primaryOptions} value={l.primary?.t ?? EMPTY} onChange={(e) => pick("primary", "t", e.target.value)} />
          <Select label="Secondary CT" options={secondaryOptions} value={l.secondary?.ct ?? EMPTY} onChange={(e) => pick("secondary", "ct", e.target.value)} />
          <Select label="Secondary T" options={secondaryOptions} value={l.secondary?.t ?? EMPTY} onChange={(e) => pick("secondary", "t", e.target.value)} />
          <Select
            label="Armor"
            options={ARMOR}
            value={l.armor ?? "kevlar_helmet"}
            onChange={(e) => onChange({ ...l, armor: e.target.value as MapLoadout["armor"] })}
          />
        </div>
      )}
    </fieldset>
  );
}

function ModeChecks({ value, onChange }: { value: PoolMode[]; onChange: (m: PoolMode[]) => void }) {
  return (
    <fieldset className={local.modes}>
      <legend className={styles.fieldLabel}>Enabled in</legend>
      {POOL_MODES.map((mode) => (
        <label key={mode} className={styles.check}>
          <input
            type="checkbox"
            checked={value.includes(mode)}
            onChange={(e) => onChange(e.target.checked ? [...value, mode] : value.filter((m) => m !== mode))}
          />
          {MODE_COPY[mode].label}
        </label>
      ))}
    </fieldset>
  );
}

function AddMap({ onAdded }: { onAdded: () => void }) {
  const toast = useToast();
  const [ref, setRef] = useState("");
  const [preview, setPreview] = useState<WorkshopPreview | null>(null);
  const [lookupError, setLookupError] = useState<string>();
  const [looking, setLooking] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [modes, setModes] = useState<PoolMode[]>([...POOL_MODES]);
  const [loadout, setLoadout] = useState<MapLoadout | null>(null);
  const [saving, setSaving] = useState(false);
  const idError = id && !POOL_MAP_ID_RE.test(id) ? "Lowercase letters, digits and underscores, 2 to 48 long" : undefined;

  async function lookup() {
    if (!ref.trim()) return;
    setLooking(true);
    setLookupError(undefined);
    setPreview(null);
    try {
      const p = await adminApi.workshopPreview(ref.trim());
      setPreview(p);
      setId(p.suggestedId);
      setName(p.item.title.slice(0, 40));
    } catch (e) {
      setLookupError(errorMessage(e));
    } finally {
      setLooking(false);
    }
  }

  async function add() {
    if (!preview || idError || !name.trim()) return;
    setSaving(true);
    try {
      const r = await adminApi.addMap({
        workshop: preview.item.workshopId,
        id,
        displayName: name.trim(),
        modes,
        ...(loadout ? { loadout } : {}),
      });
      toast.push({ title: `Added ${r.map.displayName}`, tone: "success" });
      setPreview(null);
      setRef("");
      setLoadout(null);
      onAdded();
    } catch (e) {
      toast.push({ title: "Could not add the map", body: errorMessage(e), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const item = preview?.item;
  return (
    <Card title="Add a Workshop map">
      <form
        className={local.lookup}
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <Input
          label="Workshop URL or id"
          placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=3070290869"
          value={ref}
          error={lookupError}
          onChange={(e) => setRef(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="secondary" loading={looking}>
          Look up
        </Button>
      </form>
      {item && (
        <div className={local.preview}>
          <div className={local.previewHead}>
            {item.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.previewUrl} alt={`Workshop preview of ${item.title}`} className={local.previewImg} referrerPolicy="no-referrer" />
            ) : (
              <div className={local.previewImg} aria-hidden="true" />
            )}
            <dl className={styles.dl}>
              <dt>Title</dt>
              <dd>
                <a href={item.url} target="_blank" rel="noreferrer noopener">
                  {item.title}
                </a>
              </dd>
              <dt>Author</dt>
              <dd>{item.creatorName ?? item.creatorSteamId ?? "Unknown"}</dd>
              <dt>Size</dt>
              <dd className="mono">{item.fileSize !== null ? `${(item.fileSize / 1_000_000).toFixed(1)} MB` : "--"}</dd>
              <dt>Updated</dt>
              <dd className="mono">{item.updatedAt ? item.updatedAt.slice(0, 10) : "--"}</dd>
              <dt>Subscribers</dt>
              <dd className="mono">{item.subscriptions ?? "--"}</dd>
              <dt>Tags</dt>
              <dd>
                {item.cs2 ? <Badge tone="info">CS2</Badge> : <Badge tone="warn">No CS2 tag</Badge>} <span className={styles.muted}>{item.tags.join(", ")}</span>
              </dd>
            </dl>
          </div>
          {preview.existingId ? (
            <p role="status">Already in the pool as <span className="mono">{preview.existingId}</span>.</p>
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <div className={styles.formGrid}>
                <Input label="Map id" value={id} error={idError} onChange={(e) => setId(e.target.value)} hint="Used in match records and demo names" spellCheck={false} />
                <Input label="Display name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              </div>
              <ModeChecks value={modes} onChange={setModes} />
              <LoadoutFields value={loadout} onChange={setLoadout} />
              <p className={styles.muted}>
                The preview image is shown from Steam with a link to the Workshop page. Community maps stay their authors&apos; work, remove one on request.
              </p>
              <div className={styles.actions}>
                <Button type="submit" loading={saving} disabled={!!idError || !name.trim()}>
                  Add to pool
                </Button>
                <Button variant="ghost" onClick={() => setPreview(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

function EditMap({ map, onClose, onSaved }: { map: PoolMap; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(map.displayName);
  const [loadout, setLoadout] = useState<MapLoadout | null>(map.loadout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await adminApi.updateMap(map.id, { displayName: name.trim(), loadout });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="md"
      title={`Edit ${map.displayName}`}
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Back
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Input label="Display name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <LoadoutFields value={loadout} onChange={setLoadout} />
        {error && (
          <p role="alert" className={styles.loss}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
