// Stateful fake admin backend for NEXT_PUBLIC_MOCK=1. Actions change the state and a ticker keeps it moving.
import { AIM_MAPS, isRushMode, MODES, MODE_CONFIGS, RUSH_MAP, type Mode, type TrustLevel } from "@rushsite/shared";
import { MOCK_ME, mockSteamId, mockUser, rng } from "@/lib/mock";
import type {
  AdminEventKind,
  AuditAction,
  AdminDiscordView,
  AuditEntry,
  BanView,
  EventView,
  HostView,
  MatchDetailView,
  MatchSummaryView,
  OverviewView,
  QueueTicketView,
  QueueView,
  UserCard,
  UserDetailView,
  UserSearchHit,
} from "./types";

const USER_COUNT = 48;
const ACTIVE = ["accepting", "veto", "allocating", "starting", "ready", "live"];
const HEX = "0123456789abcdef";

let rand = rng(20260923);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

function uuid(): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += HEX[Math.floor(rand() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

function card(i: number): UserCard {
  const u = mockUser(i);
  return { steamId: u.steamId, displayName: u.displayName, avatarUrl: u.avatarUrl };
}

function mapFor(mode: Mode): string {
  return isRushMode(mode) ? RUSH_MAP.id : pick(AIM_MAPS).id;
}

const iso = (ms: number) => new Date(ms).toISOString();

type World = {
  tickets: (Omit<QueueTicketView, "waitSec" | "rating"> & { ratings: Partial<Record<Mode, number>> })[];
  matches: MatchDetailView[];
  hosts: HostView[];
  events: EventView[];
  audit: AuditEntry[];
  trust: Map<string, TrustLevel>;
  bans: Map<string, BanView[]>;
  used: Set<number>;
  // Players whose cooldown an admin cleared
  cleared?: Set<string>;
  discordUnlinked?: Set<string>;
};

let world: World | null = null;

// Picks users not already queued or playing. History matches pass reserve false and may reuse anyone
function freeUsers(n: number, reserve = true): number[] {
  const out: number[] = [];
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const i = int(1, USER_COUNT - 1);
    if ((!reserve || !world!.used.has(i)) && !out.includes(i)) out.push(i);
  }
  if (reserve) out.forEach((i) => world!.used.add(i));
  return out;
}

// Next free game port on the main host
function freePort(): number {
  const taken = new Set(
    (world?.matches ?? []).filter((m) => ACTIVE.includes(m.status) && m.server).map((m) => m.server!.port),
  );
  for (let p = 27015; p < 27031; p++) if (!taken.has(p)) return p;
  return 27030;
}

function newTicket(now: number, ageSec: number) {
  const size = pick([1, 1, 1, 1, 2, 2, 3]);
  const allowed = MODES.filter((m) => MODE_CONFIGS[m].teamSize >= size);
  const modes = allowed.filter(() => rand() > 0.4);
  if (modes.length === 0) modes.push(allowed[allowed.length - 1]!);
  const players = freeUsers(size).map(card);
  const base = int(1050, 2350);
  const ratings: Partial<Record<Mode, number>> = {};
  for (const m of modes) ratings[m] = base + int(-120, 120);
  return { id: uuid(), partyId: uuid(), modes, size: players.length, players, region: "eu", enqueuedAt: iso(now - ageSec * 1000), ratings };
}

function newMatch(now: number, status: string, ageSec: number): MatchDetailView {
  const mode = pick(MODES);
  const size = MODE_CONFIGS[mode].teamSize;
  const ids = freeUsers(size * 2, ACTIVE.includes(status));
  const teams = [
    { name: "team_a", players: ids.slice(0, size).map(card) },
    { name: "team_b", players: ids.slice(size).map(card) },
  ];
  const port = ACTIVE.includes(status) ? freePort() : 27015 + int(0, 15);
  const hasServer = ["starting", "ready", "live", "finished", "abandoned"].includes(status);
  const finished = status === "finished";
  const scoreA = finished ? (isRushMode(mode) ? int(3, 8) : int(6, 16)) : 0;
  const winA = rand() > 0.5;
  const top = isRushMode(mode) ? 8 : 16;
  const score = finished ? { team_a: winA ? top : Math.min(scoreA, top - 1), team_b: winA ? Math.min(scoreA, top - 1) : top } : null;
  const createdAt = now - ageSec * 1000;
  return {
    id: uuid(),
    mode,
    status,
    source: rand() > 0.85 ? "tournament" : "queue",
    region: "eu",
    teams,
    mapId: ["accepting", "veto"].includes(status) ? null : mapFor(mode),
    hostId: hasServer ? "c0ffee00-0000-4000-8000-000000000001" : null,
    server: hasServer
      ? { ip: "203.0.113.10", port, connect: `connect 203.0.113.10:${port}; password ${uuid().slice(0, 8)}` }
      : null,
    winnerTeam: finished ? (winA ? "team_a" : "team_b") : null,
    score,
    tournamentId: null,
    cancelReason: status === "cancelled" ? pick(["Server crashed", "Allocation timed out", "Admin cancelled"]) : null,
    createdAt: iso(createdAt),
    startedAt: ["live", "finished", "abandoned"].includes(status) ? iso(createdAt + 90_000) : null,
    endedAt: ["finished", "abandoned", "cancelled"].includes(status) ? iso(createdAt + int(8, 25) * 60_000) : null,
    maps: null,
    acceptDeadline: status === "accepting" ? iso(now + 14_000) : null,
    readyAt: hasServer && status !== "starting" ? iso(createdAt + 60_000) : null,
    players: teams.flatMap((t, ti) =>
      t.players.map((p) => ({
        ...p,
        team: ti,
        accepted: status !== "accepting" || rand() > 0.5,
        connected: status === "live" ? rand() > 0.1 : status === "ready" ? rand() > 0.5 : null,
        abandoned: status === "abandoned" ? rand() > 0.7 : false,
        won: finished ? (ti === 0) === winA : null,
        kills: finished || status === "live" ? int(4, 28) : null,
        deaths: finished || status === "live" ? int(4, 24) : null,
        headshots: finished ? int(1, 14) : null,
        damage: finished ? int(600, 3200) : null,
      })),
    ),
    rounds: [],
  };
}

const WEBHOOK_TYPES = ["server_ready", "player_connected", "player_disconnected", "match_started", "round_end", "match_end"];
const ERRORS: [string, string][] = [
  ["allocation_failed", "No free slot on any host"],
  ["webhook_bad_signature", "Signature mismatch on POST /webhooks/match"],
  ["agent_timeout", "Host agent ax-fsn1-02 did not answer /health in 5s"],
  ["steam_api", "Steam Web API returned 429"],
  ["demo_upload", "Presigned PUT expired before upload finished"],
];

function newEvent(now: number, ageSec: number, kind?: "webhook" | "error"): EventView {
  const k = kind ?? (rand() > 0.85 ? "error" : "webhook");
  const live = world?.matches.filter((x) => ACTIVE.includes(x.status)) ?? [];
  const m = live.length > 0 ? pick(live) : null;
  if (k === "error") {
    const [type, message] = pick(ERRORS);
    return { id: uuid(), kind: "error", at: iso(now - ageSec * 1000), type, message, matchId: rand() > 0.5 ? (m?.id ?? null) : null, ok: false, detail: { stack: `Error: ${message}\n    at allocate (allocator.ts:88)` } };
  }
  const type = pick(WEBHOOK_TYPES);
  const bad = rand() > 0.94;
  return {
    id: uuid(),
    kind: "webhook",
    at: iso(now - ageSec * 1000),
    type,
    message: bad ? "Rejected, bad signature" : `${type} accepted`,
    matchId: m?.id ?? uuid(),
    ok: !bad,
    detail: type === "round_end" ? { round: int(1, 20), winnerTeam: pick(["team_a", "team_b"]), score: { team_a: int(0, 15), team_b: int(0, 15) } } : { event: { type } },
  };
}

function build(): World {
  rand = rng(20260923);
  const now = Date.now();
  world = { tickets: [], matches: [], hosts: [], events: [], audit: [], trust: new Map(), bans: new Map(), used: new Set([0]) };
  for (let i = 0; i < 9; i++) world.tickets.push(newTicket(now, int(4, 420)));
  for (const s of ACTIVE) world.matches.push(newMatch(now, s, int(20, 900)));
  world.matches.push(newMatch(now, "live", int(300, 1400)));
  for (let i = 0; i < 22; i++) {
    const m = newMatch(now, pick(["finished", "finished", "finished", "finished", "abandoned", "cancelled"]), int(1800, 86_000));
    world.matches.push(m);
  }
  world.hosts = [
    {
      id: "c0ffee00-0000-4000-8000-000000000001",
      name: "ax-fsn1-01",
      publicIp: "203.0.113.10",
      status: "online",
      cs2Version: "1.41.0.3",
      updating: false,
      slots: { total: 16, free: 0, used: 0 },
      lastSeenAt: iso(now - 4000),
      servers: [],
      metrics: null,
    },
    {
      id: "c0ffee00-0000-4000-8000-000000000002",
      name: "ax-fsn1-02",
      publicIp: "203.0.113.11",
      status: "updating",
      cs2Version: "1.41.0.2",
      updating: true,
      slots: { total: 16, free: 0, used: 0 },
      lastSeenAt: iso(now - 9000),
      servers: [],
      metrics: null,
    },
    {
      id: "c0ffee00-0000-4000-8000-000000000003",
      name: "ccx-hel1-peak",
      publicIp: null,
      status: "offline",
      cs2Version: null,
      updating: false,
      slots: { total: 0, free: 0, used: 0 },
      lastSeenAt: iso(now - 26 * 3600_000),
      servers: [],
      metrics: null,
    },
  ];
  syncHosts();
  let age = 5;
  for (let i = 0; i < 60; i++) {
    world.events.push(newEvent(now, age));
    age += int(15, 90);
  }
  world.bans.set(mockSteamId(7), [
    { id: uuid(), reason: "Confirmed aimbot by overwatch", bannedBy: MOCK_ME.steamId, createdAt: iso(now - 3 * 86_400_000), expiresAt: null, revokedAt: null, active: true },
  ]);
  world.audit.push({
    id: uuid(),
    adminSteamId: MOCK_ME.steamId,
    action: "user.ban",
    target: mockSteamId(7),
    payload: { reason: "Confirmed aimbot by overwatch", until: null },
    createdAt: iso(now - 3 * 86_400_000),
  });
  return world;
}

function mockState(w: World, steamId: string): UserDetailView["state"] {
  const t = w.tickets.find((x) => x.players.some((p) => p.steamId === steamId));
  const m = w.matches.find((x) => ACTIVE.includes(x.status) && x.teams.some((team) => team.players.some((p) => p.steamId === steamId)));
  return {
    queue: t ? { ticketId: t.id, partyId: t.partyId, modes: t.modes, enqueuedAt: t.enqueuedAt } : null,
    match: m ? { id: m.id, slug: null, mode: m.mode, status: m.status, createdAt: m.createdAt } : null,
  };
}

function userIndexOf(steamId: string): number {
  const n = Number(BigInt(steamId) - 76561198000000000n - 1000n);
  return n % 7919 === 0 ? n / 7919 : -1;
}

function syncHosts() {
  const w = world!;
  const running = w.matches.filter((m) => ACTIVE.includes(m.status) && m.server);
  for (const h of w.hosts) {
    if (h.slots.total === 0) continue;
    const mine = h.status === "online" ? running : running.slice(0, 0);
    h.servers = mine.map((m) => ({ slotIndex: m.server!.port - 27015, port: m.server!.port, status: "running", matchId: m.id }));
    if (h.updating) h.servers = [{ slotIndex: 3, port: 27018, status: "running", matchId: w.matches.find((m) => m.status === "live")?.id ?? null }];
    h.slots.used = h.servers.length;
    h.slots.free = h.updating ? 0 : h.slots.total - h.slots.used;
    h.metrics = mockHostMetrics(h);
  }
}

const GB = 1024 ** 3;

// An 8 thread box with 32 GB where each running server takes about one core and 4 GB
function mockHostMetrics(h: HostView): HostView["metrics"] {
  if (h.status === "offline") return null;
  const n = h.servers.length;
  return {
    sampledAt: iso(Date.now() - 4000),
    cpuPct: Math.min(100, 6 + n * 11.5),
    cpus: 8,
    load: [0.4 + n * 0.9, 0.3 + n * 0.85, 0.2 + n * 0.8],
    memUsedBytes: (3 + n * 4.1) * GB,
    memTotalBytes: 32 * GB,
    diskUsedBytes: 71 * GB,
    diskTotalBytes: 436 * GB,
    servers: h.servers.map((s, i) => ({
      pid: 40_000 + i * 17,
      port: s.port ?? 27015 + s.slotIndex,
      matchId: s.matchId ?? "",
      cpuPct: 70 + ((i * 37) % 50),
      rssBytes: (3.6 + ((i * 3) % 7) / 10) * GB,
    })),
  };
}

// Mock sign ups are three hours apart, newest first
function mockHit(u: ReturnType<typeof mockUser>, w: World): UserSearchHit {
  const i = userIndexOf(u.steamId);
  return {
    steamId: u.steamId,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    createdAt: iso(Date.now() - (i + 1) * 3 * 3600_000),
    lastLoginAt: iso(Date.now() - 3600_000),
    trustLevel: w.trust.get(u.steamId) ?? u.trustLevel,
    banned: (w.bans.get(u.steamId) ?? []).some((b) => b.active),
  };
}

function getWorld(): World {
  return world ?? build();
}

function active(): MatchDetailView[] {
  return getWorld().matches.filter((m) => ACTIVE.includes(m.status));
}

// Moves a match one step along its lifecycle
function advance(m: MatchDetailView, next: string, now: number) {
  m.status = next;
  if (next === "allocating" && !m.mapId) m.mapId = mapFor(m.mode);
  if (next === "starting" && !m.server) {
    const port = freePort();
    m.hostId = "c0ffee00-0000-4000-8000-000000000001";
    m.server = { ip: "203.0.113.10", port, connect: `connect 203.0.113.10:${port}; password ${uuid().slice(0, 8)}` };
  }
  if (next === "ready") m.readyAt = iso(now);
  if (next === "live") m.startedAt = iso(now);
  m.acceptDeadline = null;
  for (const p of m.players) {
    p.accepted = true;
    if (next === "live") {
      p.connected = true;
      p.kills = 0;
      p.deaths = 0;
    }
  }
  if (next === "finished") {
    const winA = rand() > 0.5;
    const top = isRushMode(m.mode) ? 8 : 16;
    const other = int(top === 8 ? 2 : 5, top - 1);
    m.winnerTeam = winA ? "team_a" : "team_b";
    m.score = { team_a: winA ? top : other, team_b: winA ? other : top };
    m.endedAt = iso(now);
    for (const p of m.players) {
      p.won = (p.team === 0) === winA;
      p.kills = int(4, 28);
      p.deaths = int(4, 24);
      p.headshots = int(1, 14);
      p.damage = int(600, 3200);
    }
  }
}

// Advances the fake world and reports what changed, like the api would over admin_event.
export function mockTick(): { kind: AdminEventKind; payload: unknown } {
  const w = getWorld();
  const now = Date.now();
  const r = rand();
  if (r < 0.3) {
    if (w.tickets.length < 6 || rand() > 0.5) {
      const t = newTicket(now, 0);
      w.tickets.push(t);
      return { kind: "queue", payload: { action: "ticket_added", ticketId: t.id } };
    }
    const t = w.tickets.shift()!;
    t.players.forEach((p) => w.used.delete(userIndexOf(p.steamId)));
    return { kind: "queue", payload: { action: "ticket_matched", ticketId: t.id } };
  }
  if (r < 0.55) {
    const list = active();
    const m = list.length > 0 && rand() > 0.25 ? pick(list) : null;
    if (!m) {
      const created = newMatch(now, "accepting", 0);
      w.matches.unshift(created);
      syncHosts();
      return { kind: "match", payload: { action: "created", matchId: created.id } };
    }
    const next = m.status === "live" ? "finished" : ACTIVE[ACTIVE.indexOf(m.status) + 1]!;
    advance(m, next, now);
    if (next === "finished") m.players.forEach((p) => w.used.delete(userIndexOf(p.steamId)));
    syncHosts();
    return { kind: "match", payload: { action: "status", matchId: m.id, status: next } };
  }
  if (r < 0.9) {
    const e = newEvent(now, 0, "webhook");
    w.events.unshift(e);
    return { kind: "webhook", payload: e };
  }
  if (r < 0.96) {
    const e = newEvent(now, 0, "error");
    w.events.unshift(e);
    return { kind: "error", payload: e };
  }
  const h = w.hosts[1]!;
  h.updating = !h.updating;
  h.status = h.updating ? "updating" : "online";
  if (!h.updating) h.cs2Version = w.hosts[0]!.cs2Version;
  h.lastSeenAt = iso(now);
  syncHosts();
  return { kind: "host", payload: { action: h.updating ? "update_started" : "update_finished", hostId: h.id } };
}

function audit(action: AuditAction, target: string, payload: unknown): AuditEntry {
  const entry = { id: uuid(), adminSteamId: MOCK_ME.steamId, action, target, payload, createdAt: iso(Date.now()) };
  getWorld().audit.unshift(entry);
  return entry;
}

export class MockNotFound extends Error {}

export const mockAdmin = {
  overview(): OverviewView {
    const w = getWorld();
    const now = Date.now();
    const list = active();
    const byStatus: Record<string, number> = {};
    for (const m of list) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    const hour = w.events.filter((e) => now - Date.parse(e.at) < 3600_000);
    const since = now - 86_400_000;
    const ended = w.matches.filter((m) => m.endedAt && Date.parse(m.endedAt) > since);
    const ok = (ms: number) => ({ ok: true, latencyMs: ms });
    return {
      generatedAt: iso(now),
      queue: MODES.map((mode) => {
        const t = w.tickets.filter((x) => x.modes.includes(mode));
        const oldest = Math.min(now, ...t.map((x) => Date.parse(x.enqueuedAt)));
        return { mode, tickets: t.length, players: t.reduce((n, x) => n + x.size, 0), longestWaitSec: Math.floor((now - oldest) / 1000) };
      }),
      matches: {
        active: list.length,
        byStatus,
        finished24h: ended.filter((m) => m.status === "finished").length + 214,
        abandoned24h: ended.filter((m) => m.status === "abandoned").length + 6,
      },
      hosts: {
        total: w.hosts.length,
        online: w.hosts.filter((h) => h.status === "online").length,
        updating: w.hosts.filter((h) => h.updating).length,
        slotsTotal: w.hosts.reduce((n, h) => n + h.slots.total, 0),
        slotsFree: w.hosts.reduce((n, h) => n + h.slots.free, 0),
      },
      users: { total: 3187, new24h: 42 },
      moderation: {
        activeBans: [...w.bans.values()].filter((b) => b.some((x) => x.active)).length + 11,
        openReports: 7,
        openFlags: 3,
      },
      events: {
        errorsLastHour: hour.filter((e) => e.kind === "error").length,
        webhooksLastHour: hour.filter((e) => e.kind === "webhook").length,
        failedWebhooksLastHour: hour.filter((e) => e.kind === "webhook" && !e.ok).length,
      },
      health: {
        db: ok(2),
        redis: ok(1),
        queue: ok(3),
        matches: ok(4),
        hosts: ok(38),
        events: ok(2),
      },
    };
  },

  queue(): QueueView {
    const w = getWorld();
    const now = Date.now();
    const modes = MODES.map((mode) => {
      const tickets = w.tickets
        .filter((t) => t.modes.includes(mode))
        .map(({ ratings, ...t }) => ({ ...t, rating: ratings[mode] ?? null, waitSec: Math.floor((now - Date.parse(t.enqueuedAt)) / 1000) }))
        .sort((a, b) => b.waitSec - a.waitSec);
      return { mode, players: tickets.reduce((n, t) => n + t.size, 0), tickets };
    });
    return { generatedAt: iso(now), modes, totalTickets: w.tickets.length, totalPlayers: w.tickets.reduce((n, t) => n + t.size, 0) };
  },

  matches(status: "active" | "recent"): MatchSummaryView[] {
    const w = getWorld();
    const list = status === "active" ? active() : w.matches.filter((m) => !ACTIVE.includes(m.status));
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  },

  match(id: string): MatchDetailView {
    const m = getWorld().matches.find((x) => x.id === id);
    if (!m) throw new MockNotFound("Match not found");
    return m;
  },

  hosts(): HostView[] {
    return getWorld().hosts;
  },

  events(limit: number): EventView[] {
    return getWorld().events.slice(0, limit);
  },

  user(steamId: string): UserDetailView {
    if (!/^\d{17}$/.test(steamId)) throw new MockNotFound("User not found");
    const w = getWorld();
    const i = userIndexOf(steamId);
    const r = rng(i >= 0 ? i + 1 : Number(steamId.slice(-6)));
    const base = i >= 0 ? mockUser(i) : { steamId, displayName: `player_${steamId.slice(-4)}`, avatarUrl: null, trustLevel: "new" as TrustLevel, region: "eu" };
    const now = Date.now();
    const bans = w.bans.get(steamId) ?? [];
    const level = w.trust.get(steamId) ?? base.trustLevel;
    const vac = i === 7 ? 1 : 0;
    const accountDays = Math.floor(400 + r() * 4000);
    const playMinutes = Math.floor(3000 + r() * 180_000);
    const ratings = MODES.filter((_, k) => k === 0 || r() > 0.3).map((mode) => {
      const played = 5 + Math.floor(r() * 180);
      const wins = Math.floor(played * (0.4 + r() * 0.25));
      return { mode, rating: Math.round(1000 + r() * 1400), rd: Math.round(50 + r() * 120), matchesPlayed: played, wins, losses: played - wins, updatedAt: iso(now - Math.floor(r() * 5) * 86_400_000) };
    });
    const recentMatches = w.matches
      .filter((m) => m.teams.some((t) => t.players.some((p) => p.steamId === steamId)))
      .concat(
        Array.from({ length: 8 }, (_, k) => {
          const m = newMatch(now, k === 3 ? "abandoned" : "finished", 3600 * (k + 1) + 400);
          return m;
        }),
      )
      .slice(0, 10)
      .map((m) => {
        const team = m.teams.findIndex((t) => t.players.some((p) => p.steamId === steamId));
        const t = team < 0 ? Math.floor(r() * 2) : team;
        return {
          id: m.id,
          slug: null,
          bestOf: null,
          mode: m.mode,
          status: m.status,
          team: t,
          won: m.winnerTeam ? m.winnerTeam === m.teams[t]?.name : null,
          abandoned: m.status === "abandoned" && r() > 0.5,
          kills: m.players[0]?.kills ?? null,
          deaths: m.players[0]?.deaths ?? null,
          headshots: m.players[0]?.headshots ?? null,
          score: m.score,
          mapId: m.mapId,
          createdAt: m.createdAt,
        };
      });
    return {
      user: {
        steamId,
        displayName: base.displayName,
        avatarUrl: base.avatarUrl,
        region: "eu",
        countryCode: ["DE", "SE", "PL", "FR", "GB", "DK", "FI"][Math.floor(r() * 7)]!,
        profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
        createdAt: iso(now - Math.floor(20 + r() * 300) * 86_400_000),
        lastLoginAt: iso(now - Math.floor(r() * 48) * 3600_000),
      },
      steam: {
        personaName: base.displayName,
        accountCreatedAt: iso(now - accountDays * 86_400_000),
        cs2PlaytimeMinutes: playMinutes,
        communityVisibility: 3,
        fetchedAt: iso(now - 2 * 86_400_000),
      },
      trust: { level, reason: w.trust.has(steamId) ? "Set by admin" : "Clean signup checks and 5 clean matches", locked: w.trust.has(steamId), updatedAt: iso(now - 86_400_000) },
      trustSignals: [
        { id: uuid(), source: "steam_bans", clean: vac === 0, data: { VACBanned: vac > 0, NumberOfVACBans: vac, NumberOfGameBans: 0, CommunityBanned: false, DaysSinceLastBan: vac ? 412 : 0 }, fetchedAt: iso(now - 2 * 86_400_000) },
        { id: uuid(), source: "steam_profile", clean: true, data: { accountAgeDays: accountDays, cs2Hours: Math.round(playMinutes / 60), visibility: "public" }, fetchedAt: iso(now - 2 * 86_400_000) },
        i % 4 === 0
          ? { id: uuid(), source: "faceit", clean: true, data: null, fetchedAt: iso(now - 2 * 86_400_000) }
          : { id: uuid(), source: "faceit", clean: true, data: { nickname: base.displayName, banned: false, pastBans: 0, skillLevel: 1 + Math.floor(r() * 10), elo: Math.floor(800 + r() * 2200), matchesPlayed: Math.floor(r() * 1400) }, fetchedAt: iso(now - 2 * 86_400_000) },
        { id: uuid(), source: "platform", clean: i !== 7, data: { reportsReceived: i === 7 ? 9 : 1, reviewOutcomes: i === 7 ? ["cheat"] : [] }, fetchedAt: iso(now - 3600_000) },
      ],
      ratings,
      recentMatches,
      bans,
      activeBan: bans.find((b) => b.active) ?? null,
      cooldowns: i % 6 === 1 && !w.cleared?.has(steamId) ? [{ reason: "decline", endsAt: iso(now + 240_000), offence: 2 }] : [],
      reports: { received: i === 7 ? 9 : 1, open: i === 7 ? 2 : 0 },
      flags: { open: i === 7 ? 1 : 0, total: i === 7 ? 2 : 0 },
      state: mockState(w, steamId),
      audit: w.audit
        .filter((a) => a.target === steamId)
        .map((a) => ({ ...a, adminName: a.adminSteamId === MOCK_ME.steamId ? MOCK_ME.displayName : null })),
    };
  },

  searchUsers(q: string): UserSearchHit[] {
    const lower = q.trim().toLowerCase();
    if (lower.length < 2) throw new Error("Enter at least 2 characters");
    const w = getWorld();
    return Array.from({ length: USER_COUNT }, (_, i) => mockUser(i))
      .filter((u) => (lower.length < 3 ? u.displayName.toLowerCase().startsWith(lower) : u.displayName.toLowerCase().includes(lower)) || u.steamId.startsWith(lower))
      .slice(0, 20)
      .map((u) => mockHit(u, w));
  },

  newestUsers(limit: number): UserSearchHit[] {
    const w = getWorld();
    return Array.from({ length: USER_COUNT }, (_, i) => mockUser(i))
      .slice(0, limit)
      .map((u) => mockHit(u, w));
  },

  // Every third mock player has Discord linked
  discord(steamId: string): AdminDiscordView {
    const w = getWorld();
    const linked = userIndexOf(steamId) % 3 === 0 && !w.discordUnlinked?.has(steamId);
    return {
      enabled: true,
      link: linked
        ? {
            discordId: `70000000000${steamId.slice(-7)}`,
            username: `player${steamId.slice(-4)}`,
            globalName: null,
            avatarUrl: null,
            discordCreatedAt: "2021-03-14T10:00:00.000Z",
            linkedAt: "2026-09-20T18:30:00.000Z",
            roleGranted: userIndexOf(steamId) % 2 === 0,
            syncedAt: "2026-09-20T18:30:00.000Z",
            syncError: userIndexOf(steamId) % 2 === 0 ? null : "not_in_server",
          }
        : null,
    };
  },

  discordUnlink(steamId: string): AuditEntry {
    const d = mockAdmin.discord(steamId);
    if (!d.link) throw new Error("No Discord account is linked");
    (getWorld().discordUnlinked ??= new Set()).add(steamId);
    return audit("user.discord_unlink", steamId, { discordId: d.link.discordId, username: d.link.username });
  },

  discordSync(steamId: string): AuditEntry {
    const d = mockAdmin.discord(steamId);
    if (!d.link) throw new Error("No Discord account is linked");
    return audit("user.discord_sync", steamId, { roleGranted: d.link.roleGranted, error: d.link.syncError });
  },

  clearCooldown(steamId: string): AuditEntry {
    const w = getWorld();
    const i = userIndexOf(steamId);
    if (i % 6 !== 1 || w.cleared?.has(steamId)) throw new Error("User has no running cooldown");
    (w.cleared ??= new Set()).add(steamId);
    return audit("user.cooldown_clear", steamId, { cleared: [{ reason: "decline", offence: 2 }] });
  },

  removeTicket(ticketId: string, reason?: string): AuditEntry {
    const w = getWorld();
    const idx = w.tickets.findIndex((t) => t.id === ticketId);
    if (idx < 0) throw new MockNotFound("Ticket not in queue");
    const [t] = w.tickets.splice(idx, 1);
    t!.players.forEach((p) => w.used.delete(userIndexOf(p.steamId)));
    return audit("queue.remove", ticketId, { reason: reason ?? null });
  },

  cancelMatch(id: string, reason: string): AuditEntry {
    const m = getWorld().matches.find((x) => x.id === id && ACTIVE.includes(x.status));
    if (!m) throw new MockNotFound("Match not found or already over");
    m.status = "cancelled";
    m.cancelReason = reason;
    m.players.forEach((p) => getWorld().used.delete(userIndexOf(p.steamId)));
    m.endedAt = iso(Date.now());
    syncHosts();
    return audit("match.cancel", id, { reason });
  },

  ban(steamId: string, reason: string, until: string | null): AuditEntry {
    const w = getWorld();
    const list = w.bans.get(steamId) ?? [];
    list.unshift({ id: uuid(), reason, bannedBy: MOCK_ME.steamId, createdAt: iso(Date.now()), expiresAt: until, revokedAt: null, active: true });
    w.bans.set(steamId, list);
    return audit("user.ban", steamId, { reason, until });
  },

  unban(steamId: string): AuditEntry {
    const list = getWorld().bans.get(steamId) ?? [];
    const act = list.filter((b) => b.active);
    if (act.length === 0) throw new MockNotFound("User has no active ban");
    for (const b of act) {
      b.active = false;
      b.revokedAt = iso(Date.now());
    }
    return audit("user.unban", steamId, {});
  },

  setTrust(steamId: string, level: TrustLevel): AuditEntry {
    const w = getWorld();
    const before = w.trust.get(steamId) ?? null;
    w.trust.set(steamId, level);
    return audit("user.trust", steamId, { level, before });
  },

  sampleSteamIds(): string[] {
    return [1, 2, 3, 7, 12].map(mockSteamId);
  },
};
