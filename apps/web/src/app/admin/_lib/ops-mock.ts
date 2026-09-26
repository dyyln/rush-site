// Fake flags, announcements and metrics for NEXT_PUBLIC_MOCK=1
import { MODES, queueOpenFlag, type Mode } from "@rushsite/shared";
import { MOCK_ME, mockSteamId, rng } from "@/lib/mock";
import { MockNotFound } from "./mock";
import type {
  Announcement,
  AuditAction,
  AuditEntry,
  DemoRecordingView,
  FeatureFlag,
  HostMetricsView,
  MetricPoint,
  MetricsRange,
  MetricsView,
  ResolvedProfile,
} from "./types";

const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const flags = new Map<string, FeatureFlag>([
  ["cups.weekly", { key: "cups.weekly", enabled: true, value: null, updatedBy: MOCK_ME.steamId, updatedAt: iso(Date.now() - 86_400_000) }],
]);
const notices: Announcement[] = [
  {
    id: id(),
    text: "3v3 Rush is live. Queue up and tell us how the rooms feel.",
    level: "info",
    startsAt: iso(Date.now() - 3600_000),
    endsAt: null,
    dismissible: true,
    createdAt: iso(Date.now() - 3600_000),
    updatedAt: iso(Date.now() - 3600_000),
  },
];

function audit(action: AuditAction, target: string, payload: unknown): AuditEntry {
  return { id: id(), adminSteamId: MOCK_ME.steamId, action, target, payload, createdAt: iso(Date.now()) };
}

const RANGES: Record<MetricsRange, { span: number; step: number; mStep: number }> = {
  "1h": { span: 3600_000, step: 60_000, mStep: 300_000 },
  "24h": { span: 86_400_000, step: 600_000, mStep: 3600_000 },
  "7d": { span: 7 * 86_400_000, step: 3600_000, mStep: 3600_000 },
};

function wave(from: number, to: number, step: number, seed: number, base: number, amp: number, gapAt?: number): MetricPoint[] {
  const r = rng(seed);
  const out: MetricPoint[] = [];
  for (let t = from; t < to; t += step) {
    const hour = new Date(t).getUTCHours() + new Date(t).getUTCMinutes() / 60;
    // Evening peak around 20:00 UTC
    const daily = 0.5 + 0.5 * Math.cos(((hour - 20) / 24) * 2 * Math.PI);
    const v = Math.max(0, base + amp * daily + (r() - 0.5) * amp * 0.4);
    const gap = gapAt !== undefined && Math.abs(t - gapAt) < step * 3;
    out.push({ t, v: gap ? null : Math.round(v * 10) / 10 });
  }
  return out;
}

let demoRecording: DemoRecordingView = { enabled: false, s3Configured: false, updatedBy: null, updatedAt: null };

export const mockOps = {
  demoRecording(): DemoRecordingView {
    return demoRecording;
  },
  setDemoRecording(enabled: boolean) {
    const before = demoRecording.enabled;
    demoRecording = { ...demoRecording, enabled, updatedBy: MOCK_ME.steamId, updatedAt: iso(Date.now()) };
    return { setting: demoRecording, audit: audit("demo_recording.set", "demo.recording", { enabled, before }) };
  },
  flags(): FeatureFlag[] {
    return [...flags.values()].sort((a, b) => a.key.localeCompare(b.key));
  },
  setFlag(key: string, enabled: boolean, value?: unknown) {
    const before = flags.get(key) ?? null;
    const flag: FeatureFlag = { key, enabled, value: value === undefined ? (before?.value ?? null) : value, updatedBy: MOCK_ME.steamId, updatedAt: iso(Date.now()) };
    flags.set(key, flag);
    return { flag, audit: audit("flag.set", key, { enabled, value: flag.value }) };
  },
  deleteFlag(key: string) {
    if (!flags.delete(key)) throw new MockNotFound("Flag not found");
    return { ok: true as const, audit: audit("flag.delete", key, {}) };
  },
  closedModes(): Mode[] {
    return MODES.filter((m) => flags.get(queueOpenFlag(m))?.enabled === false);
  },
  announcements(): Announcement[] {
    return [...notices].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  },
  activeAnnouncements(): Announcement[] {
    const now = Date.now();
    return mockOps.announcements().filter((a) => Date.parse(a.startsAt) <= now && (!a.endsAt || Date.parse(a.endsAt) > now));
  },
  createAnnouncement(input: { text: string; level: "info" | "warn"; startsAt?: string; endsAt?: string | null; dismissible: boolean }) {
    const now = iso(Date.now());
    const a: Announcement = { id: id(), text: input.text, level: input.level, startsAt: input.startsAt ?? now, endsAt: input.endsAt ?? null, dismissible: input.dismissible, createdAt: now, updatedAt: now };
    notices.push(a);
    return { announcement: a, audit: audit("announcement.create", a.id, a) };
  },
  updateAnnouncement(aid: string, patch: Partial<Pick<Announcement, "text" | "level" | "startsAt" | "endsAt" | "dismissible">>) {
    const a = notices.find((x) => x.id === aid);
    if (!a) throw new MockNotFound("Announcement not found");
    Object.assign(a, patch, { updatedAt: iso(Date.now()) });
    return { announcement: a, audit: audit("announcement.update", aid, patch) };
  },
  deleteAnnouncement(aid: string) {
    const i = notices.findIndex((x) => x.id === aid);
    if (i < 0) throw new MockNotFound("Announcement not found");
    notices.splice(i, 1);
    return { ok: true as const, audit: audit("announcement.delete", aid, {}) };
  },
  metrics(range: MetricsRange): MetricsView {
    const cfg = RANGES[range];
    const to = Math.floor(Date.now() / cfg.step) * cfg.step + cfg.step;
    const from = to - cfg.span;
    const mTo = Math.floor(Date.now() / cfg.mStep) * cfg.mStep + cfg.mStep;
    const gap = from + cfg.span * 0.35;
    const perMode = (base: number[], amp: number[], seed: number) =>
      Object.fromEntries(MODES.map((m, i) => [m, wave(from, to, cfg.step, seed + i, base[i]!, amp[i]!, gap)])) as Record<Mode, MetricPoint[]>;
    const bars = wave(mTo - cfg.span, mTo, cfg.mStep, 99, 1, range === "1h" ? 4 : 30).map((p) => ({ t: p.t, v: p.v === null ? null : Math.round(p.v) }));
    return {
      range,
      from: iso(from),
      to: iso(to),
      stepSec: cfg.step / 1000,
      queueDepth: perMode([2, 1, 4], [10, 6, 22], 7),
      medianWaitSec: perMode([20, 35, 50], [30, 60, 90], 17),
      activeSockets: wave(from, to, cfg.step, 3, 40, 220, gap),
      matchesFound: bars,
      matchesStepSec: cfg.mStep / 1000,
    };
  },
  hostMetrics(hostId: string, range: MetricsRange): HostMetricsView {
    const cfg = RANGES[range];
    const to = Math.floor(Date.now() / cfg.step) * cfg.step + cfg.step;
    const from = to - cfg.span;
    const seed = Number.parseInt(hostId.slice(-2), 16) || 1;
    // The offline mock host has no history
    const off = hostId.endsWith("3");
    const pct = (points: MetricPoint[]) => points.map((p) => ({ t: p.t, v: off || p.v === null ? null : Math.min(100, p.v) }));
    return {
      hostId,
      range,
      from: iso(from),
      to: iso(to),
      stepSec: cfg.step / 1000,
      allocPct: pct(wave(from, to, cfg.step, seed, 10, 80)),
      cpuPct: pct(wave(from, to, cfg.step, seed + 1, 8, 60)),
      memPct: pct(wave(from, to, cfg.step, seed + 2, 30, 35)),
      load1: pct(wave(from, to, cfg.step, seed + 3, 0.5, 6)),
    };
  },
  resolve(q: string): ResolvedProfile {
    const m = q.match(/(\d{17})/);
    const steamId = m ? m[1]! : mockSteamId(3);
    return { steamId, registered: true, user: { steamId, displayName: `player-${steamId.slice(-4)}`, avatarUrl: null } };
  },
};
