// Stateful fake of the admin cup routes for NEXT_PUBLIC_MOCK=1.
import type { CreateCup, CupSchedule, CupSchedulePatch, CupScheduleCreate, Mode, OpenCupOutcome } from "@rushsite/shared";
import { MOCK_TOURNAMENTS, mockTournamentDetail } from "@/lib/mock";
import { MODE_COPY } from "@/lib/modes";
import type { BracketMatch, TournamentDetail, TournamentSummary } from "@/lib/types";

export class MockCupError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type World = { schedules: CupSchedule[]; cups: Map<string, TournamentDetail>; stripped: Set<string> };
let world: World | null = null;
let seq = 0;

const MAX: Record<"daily" | "weekly", Record<Mode, number>> = {
  daily: { aim1v1: 32, aim2v2: 16, rush3v3: 16 },
  weekly: { aim1v1: 64, aim2v2: 32, rush3v3: 32 },
};

function id(prefix: string): string {
  seq += 1;
  return `${prefix}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function nextStart(s: Pick<CupSchedule, "cadence" | "weekday" | "startTime">, after = Date.now()): string {
  const [h, m] = s.startTime.split(":").map(Number);
  const d = new Date(after);
  d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
  if (s.cadence === "weekly") {
    d.setUTCDate(d.getUTCDate() + (((s.weekday ?? 0) - d.getUTCDay() + 7) % 7));
    if (d.getTime() <= after) d.setUTCDate(d.getUTCDate() + 7);
  } else if (d.getTime() <= after) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}

function state(): World {
  if (world) return world;
  const schedules: CupSchedule[] = [];
  for (const cadence of ["daily", "weekly"] as const) {
    for (const mode of ["aim1v1", "aim2v2", "rush3v3"] as const) {
      const s = {
        id: id("5c0ed01e"),
        cupKey: `${cadence}-${mode}`,
        name: `${cadence === "daily" ? "Daily" : "Weekly"} ${MODE_COPY[mode].label} Cup`,
        mode,
        cadence,
        weekday: cadence === "weekly" ? 0 : null,
        startTime: cadence === "daily" ? "18:00" : "17:00",
        maxEntrants: MAX[cadence][mode],
        minTrust: "verified" as const,
        bestOfFinal: 3 as const,
        enabled: !(cadence === "weekly" && mode === "aim2v2"),
        updatedAt: new Date().toISOString(),
      };
      schedules.push({ ...s, nextStartsAt: s.enabled ? nextStart(s) : null });
    }
  }
  const cups = new Map<string, TournamentDetail>();
  for (const t of MOCK_TOURNAMENTS) {
    if (t.status === "cancelled") continue;
    const d = mockTournamentDetail(t.id);
    if (d) cups.set(t.id, structuredClone(d));
  }
  world = { schedules, cups, stripped: new Set() };
  return world;
}

function cupOf(tournamentId: string): TournamentDetail {
  const t = state().cups.get(tournamentId);
  if (!t) throw new MockCupError(404, "not_found", "Tournament not found");
  return t;
}

function summaryOf(t: TournamentDetail): TournamentSummary {
  const { entries: _e, bracket: _b, bracketVersion: _v, myEntryId: _m, ...rest } = t;
  return { ...rest, entrantCount: t.entries.filter((e) => !e.disqualified).length };
}

const OPEN = ["ready", "provisioning", "live"];

function retire(cupKey: string): OpenCupOutcome | null {
  const t = [...state().cups.values()].find((c) => c.cupKey === cupKey && c.status === "open");
  if (!t) return null;
  const entrantCount = t.entries.filter((e) => !e.disqualified).length;
  if (entrantCount > 0) return { tournamentId: t.id, name: t.name, action: "kept", entrantCount };
  t.status = "cancelled";
  return { tournamentId: t.id, name: t.name, action: "cancelled", entrantCount: 0 };
}

function finish(t: TournamentDetail, m: BracketMatch, winner: string | null, resolution: BracketMatch["resolution"]) {
  m.status = "done";
  m.winner = winner;
  m.resolution = resolution;
  m.liveMatchId = null;
  const bracket = t.bracket!;
  t.bracketVersion += 1;
  if (m.round === bracket.rounds) {
    t.status = "completed";
    t.winnerEntryId = winner;
    return;
  }
  const next = bracket.matches.find((x) => x.round === m.round + 1 && x.index === Math.floor(m.index / 2));
  if (!next) return;
  if (m.index % 2 === 0) {
    next.a = winner;
    next.aResolved = true;
  } else {
    next.b = winner;
    next.bResolved = true;
  }
  if (next.a && next.b && next.status === "pending") next.status = "ready";
}

function applySchedule(s: CupSchedule): CupSchedule {
  s.weekday = s.cadence === "weekly" ? (s.weekday ?? 0) : null;
  s.nextStartsAt = s.enabled ? nextStart(s) : null;
  s.updatedAt = new Date().toISOString();
  return s;
}

export const mockCups = {
  schedules(): CupSchedule[] {
    return state().schedules.map((s) => applySchedule({ ...s }));
  },
  createSchedule(body: CupScheduleCreate): CupSchedule {
    if (body.cadence === "weekly" && (body.weekday === null || body.weekday === undefined)) {
      throw new MockCupError(400, "invalid_request", "Weekly schedules need a weekday");
    }
    const s = applySchedule({
      id: id("5c0ed01e"),
      cupKey: `${body.cadence}-${body.mode}-${seq}`,
      name: body.name ?? `${body.cadence === "daily" ? "Daily" : "Weekly"} ${MODE_COPY[body.mode].label} Cup`,
      mode: body.mode,
      cadence: body.cadence,
      weekday: body.weekday ?? null,
      startTime: body.startTime,
      maxEntrants: body.maxEntrants,
      minTrust: body.minTrust,
      bestOfFinal: body.bestOfFinal ?? 3,
      enabled: body.enabled ?? true,
      nextStartsAt: null,
      updatedAt: "",
    });
    state().schedules.push(s);
    return s;
  },
  updateSchedule(scheduleId: string, patch: CupSchedulePatch): { schedule: CupSchedule; openCup: OpenCupOutcome | null } {
    const s = state().schedules.find((x) => x.id === scheduleId);
    if (!s) throw new MockCupError(404, "not_found", "Schedule not found");
    const next = { ...s, ...patch };
    if (next.cadence === "weekly" && (next.weekday === null || next.weekday === undefined)) {
      throw new MockCupError(400, "invalid_request", "Weekly schedules need a weekday");
    }
    const turningOff = s.enabled && next.enabled === false;
    Object.assign(s, next);
    return { schedule: applySchedule(s), openCup: turningOff ? retire(s.cupKey) : null };
  },
  deleteSchedule(scheduleId: string): OpenCupOutcome | null {
    const w = state();
    const s = w.schedules.find((x) => x.id === scheduleId);
    if (!s) throw new MockCupError(404, "not_found", "Schedule not found");
    w.schedules = w.schedules.filter((x) => x.id !== scheduleId);
    return retire(s.cupKey);
  },
  completed(): TournamentSummary[] {
    return [...state().cups.values()].filter((t) => t.status === "completed").map(summaryOf);
  },
  stripBadges(tournamentId: string, entryId: string) {
    const t = cupOf(tournamentId);
    if (t.status !== "completed") throw new MockCupError(409, "not_completed", "Badges exist only for completed cups");
    const e = t.entries.find((x) => x.id === entryId);
    if (!e) throw new MockCupError(404, "not_found", "Entry not found");
    const w = state();
    if (w.stripped.has(entryId)) throw new MockCupError(409, "no_badges", "This entry has no badges from this cup");
    w.stripped.add(entryId);
    return { ok: true as const, removed: e.steamIds.length };
  },

  active(): TournamentSummary[] {
    return [...state().cups.values()]
      .filter((t) => t.status === "open" || t.status === "running")
      .map(summaryOf)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  },
  detail(tournamentId: string): TournamentDetail {
    return cupOf(tournamentId);
  },
  createCup(body: CreateCup): TournamentSummary {
    if (Date.parse(body.startsAt) <= Date.now() + 60_000) {
      throw new MockCupError(400, "invalid_request", "startsAt must be at least a minute in the future");
    }
    const tid = id("c0ffee00");
    const t: TournamentDetail = {
      id: tid,
      cupKey: `special-${tid}`,
      name: body.name,
      mode: body.mode,
      cadence: "special",
      status: "open",
      startsAt: new Date(body.startsAt).toISOString(),
      startedAt: null,
      completedAt: null,
      maxEntrants: body.maxEntrants,
      entrantCount: 0,
      minTrust: body.minTrust,
      entryFee: 0,
      format: { type: "single_elimination", bestOf: { default: 1, semis: 1, final: body.bestOfFinal ?? 3 } },
      checkIn: false,
      winnerEntryId: null,
      entries: [],
      bracket: null,
      bracketVersion: 0,
      myEntryId: null,
    };
    state().cups.set(tid, t);
    return summaryOf(t);
  },
  cancel(tournamentId: string) {
    const t = cupOf(tournamentId);
    if (t.status !== "open" && t.status !== "running") throw new MockCupError(409, "tournament_over", `Tournament is already ${t.status}`);
    t.status = "cancelled";
    return { ok: true as const, tournament: summaryOf(t) };
  },
  reschedule(tournamentId: string, startsAt: string) {
    const t = cupOf(tournamentId);
    if (t.status !== "open") throw new MockCupError(409, "already_started", "Only open cups can be rescheduled");
    if (Date.parse(startsAt) <= Date.now() + 60_000) {
      throw new MockCupError(400, "invalid_request", "startsAt must be at least a minute in the future");
    }
    t.startsAt = new Date(startsAt).toISOString();
    return { ok: true as const, tournament: summaryOf(t) };
  },
  disqualify(tournamentId: string, entryId: string) {
    const t = cupOf(tournamentId);
    const e = t.entries.find((x) => x.id === entryId);
    if (!e) throw new MockCupError(404, "not_found", "Entry not found");
    if (e.disqualified) throw new MockCupError(409, "already_disqualified", "Entry is already disqualified");
    e.disqualified = true;
    const m = t.bracket?.matches.find((x) => (x.a === entryId || x.b === entryId) && OPEN.includes(x.status));
    if (m) finish(t, m, m.a === entryId ? m.b : m.a, "disqualified");
    return { ok: true as const, tournament: summaryOf(t) };
  },
  forceResult(tournamentId: string, bracketMatchId: string, winnerEntryId: string) {
    const t = cupOf(tournamentId);
    if (t.status !== "running") throw new MockCupError(409, "not_running", "Tournament is not running");
    const m = t.bracket?.matches.find((x) => x.id === bracketMatchId);
    if (!m) throw new MockCupError(404, "not_found", "Bracket match not found");
    if (!OPEN.includes(m.status)) throw new MockCupError(409, "match_not_open", `Bracket match is ${m.status}`);
    if (winnerEntryId !== m.a && winnerEntryId !== m.b) {
      throw new MockCupError(400, "not_in_match", "Winner must be one of the two entries in the match");
    }
    finish(t, m, winnerEntryId, "admin_decision");
    return { ok: true as const, tournament: summaryOf(t) };
  },
};
