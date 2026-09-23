// Deterministic mock data so server and client renders match.
import { AIM_MAPS, MODES, RUSH_MAP, tierForRating, type Mode, type PartyUpdatePayload } from "@rushsite/shared";
import { MOCK_LIVE_MATCH_ID, MOCK_MATCH_HINTS } from "./mock-match";
import type {
  Bracket,
  BracketMatch,
  EntryView,
  Leaderboard,
  LeaderboardRow,
  MatchSummary,
  ModeStats,
  Profile,
  TournamentDetail,
  TournamentSummary,
  User,
} from "./types";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NAMES = [
  "vexa", "kolt", "mirren", "ashgrove", "tessler", "b1tter", "nollie", "quarry", "harlan", "sunk",
  "drift", "orbit", "palecrow", "juno", "reyk", "fenn", "lowkey", "strata", "tamsin", "voss",
  "kettle", "embr", "crane", "dusk", "haze", "morrow", "pike", "ridley", "slate", "tovi",
  "umber", "wren", "yarrow", "zeph", "alder", "brisk", "cinder", "dover", "elm", "flint",
];

// Stable fake UUID from any string
export function mockUuid(key: string): string {
  const hex = [hash(key), hash(key + "1"), hash(key + "2"), hash(key + "3")].map((n) => n.toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function mockSteamId(i: number): string {
  return String(76561198000000000n + BigInt(1000 + i * 7919));
}

export const MOCK_ME: User = {
  steamId: mockSteamId(0),
  displayName: "meridius",
  avatarUrl: null,
  trustLevel: "verified",
  region: "eu",
  isAdmin: true,
};

export function mockUser(i: number): User {
  if (i === 0) return MOCK_ME;
  return {
    steamId: mockSteamId(i),
    displayName: NAMES[i % NAMES.length]!,
    avatarUrl: null,
    trustLevel: i % 5 === 0 ? "new" : i % 3 === 0 ? "trusted" : "verified",
    region: "eu",
  };
}

function userIndex(steamId: string): number {
  const n = Number(BigInt(steamId) - 76561198000000000n - 1000n);
  return n % 7919 === 0 ? n / 7919 : -1;
}

export function mockUserBySteamId(steamId: string): User {
  const i = userIndex(steamId);
  if (i >= 0) return mockUser(i);
  return { steamId, displayName: `player_${steamId.slice(-4)}`, avatarUrl: null, trustLevel: "new", region: "eu" };
}

// Leaderboard

const BASE_RATING: Record<Mode, number> = { aim1v1: 2480, aim2v2: 2390, rush3v3: 2310 };

export function mockLeaderboard(mode: Mode, offset = 0, limit = 50): Leaderboard {
  const total = 240;
  const r = rng(hash(mode));
  const rows: LeaderboardRow[] = [];
  let rating = BASE_RATING[mode];
  for (let i = 0; i < total; i++) {
    rating -= 2 + r() * 12;
    const matches = 20 + Math.floor(r() * 400);
    const wins = Math.floor(matches * (0.42 + r() * 0.24));
    const u = mockUser(i + 1);
    rows.push({
      rank: i + 1,
      steamId: u.steamId,
      displayName: u.displayName + (i >= NAMES.length ? String(Math.floor(i / NAMES.length)) : ""),
      avatarUrl: null,
      rating: Math.round(rating),
      tier: tierForRating(rating).id,
      matches,
      wins,
    });
  }
  return { mode, total, rows: rows.slice(offset, offset + limit) };
}

// Profile

const DAY = 86_400_000;
// Fixed reference time so SSR and hydration agree
export const MOCK_NOW = Date.UTC(2026, 8, 23, 18, 0, 0);

function mockModeStats(steamId: string, mode: Mode): ModeStats {
  const r = rng(hash(steamId + mode));
  const points = 30;
  let rating = 1350 + r() * 500;
  const history = Array.from({ length: points }, (_, i) => {
    rating += (r() - 0.42) * 40;
    return { ts: MOCK_NOW - (points - i) * DAY * 0.8, rating: Math.round(rating) };
  });
  const matches = 40 + Math.floor(r() * 200);
  const wins = Math.floor(matches * (0.45 + r() * 0.15));
  const maps = mode === "rush3v3" ? [RUSH_MAP] : AIM_MAPS;
  const bestMaps = maps
    .map((m) => {
      const n = 5 + Math.floor(r() * 40);
      return { mapId: m.id, matches: n, wins: Math.floor(n * (0.35 + r() * 0.35)) };
    })
    .sort((a, b) => b.wins / b.matches - a.wins / a.matches)
    .slice(0, 3);
  return {
    mode,
    rating: Math.round(rating),
    rd: Math.round(50 + r() * 40),
    tier: tierForRating(rating).id,
    matches,
    wins,
    losses: matches - wins,
    headshotPct: 0.35 + r() * 0.3,
    kd: 0.8 + r() * 0.6,
    history,
    bestMaps,
    leaderboardRank: matches >= 20 ? 20 + Math.floor(r() * 400) : null,
  };
}

function hinted(id: string, mode: Mode, mapId: string): string {
  MOCK_MATCH_HINTS.set(id, { mode, mapId });
  return id;
}

function mockMatches(steamId: string): MatchSummary[] {
  const r = rng(hash(steamId + "matches"));
  return Array.from({ length: 12 }, (_, i) => {
    const mode = MODES[Math.floor(r() * MODES.length)]!;
    const aim = mode !== "rush3v3";
    const win = r() > 0.45;
    const loserScore = Math.floor(r() * (aim ? 15 : 7));
    const mapId = aim ? AIM_MAPS[Math.floor(r() * AIM_MAPS.length)]!.id : RUSH_MAP.id;
    const kills = 8 + Math.floor(r() * 20);
    const abandoned = i === 7;
    return {
      matchId: hinted(mockUuid(steamId + i), mode, mapId),
      mode,
      mapId,
      playedAt: new Date(MOCK_NOW - i * DAY * 0.6 - r() * DAY * 0.3).toISOString(),
      result: abandoned ? "abandoned" : win ? "win" : "loss",
      scoreFor: win ? (aim ? 16 : 8) : loserScore,
      scoreAgainst: win ? loserScore : aim ? 16 : 8,
      ratingDelta: abandoned ? -28 : win ? 8 + Math.round(r() * 14) : -(8 + Math.round(r() * 14)),
      kills,
      deaths: 6 + Math.floor(r() * 18),
      headshots: Math.floor(kills * (0.3 + r() * 0.4)),
    };
  });
}

export function mockProfile(steamId: string): Profile {
  return {
    user: mockUserBySteamId(steamId),
    modes: MODES.map((m) => mockModeStats(steamId, m)),
    badges: [
      {
        id: "b1",
        kind: "cup_champion",
        tournamentId: MOCK_TOURNAMENT_IDS[3]!,
        tournamentName: "Weekly Aim Cup",
        mode: "aim1v1",
        awardedAt: new Date(MOCK_NOW - 6 * DAY).toISOString(),
      },
      {
        id: "b2",
        kind: "cup_semifinalist",
        tournamentId: MOCK_TOURNAMENT_IDS[4]!,
        tournamentName: "Daily Rush Cup",
        mode: "rush3v3",
        awardedAt: new Date(MOCK_NOW - 2 * DAY).toISOString(),
      },
      {
        id: "b3",
        kind: "cup_runner_up",
        tournamentId: MOCK_TOURNAMENT_IDS[5]!,
        tournamentName: "Daily Duo Aim Cup",
        mode: "aim2v2",
        awardedAt: new Date(MOCK_NOW - 9 * DAY).toISOString(),
      },
    ],
    recentMatches: mockMatches(steamId),
  };
}

// Party

export function mockParty(size = 2): PartyUpdatePayload {
  const members = Array.from({ length: size }, (_, i) => {
    const u = mockUser(i === 0 ? 0 : i + 3);
    return { steamId: u.steamId, displayName: u.displayName, avatarUrl: u.avatarUrl };
  });
  return {
    partyId: "5b0c9f1e-3a7d-4e2b-9c11-1f2a3b4c5d6e",
    leaderSteamId: MOCK_ME.steamId,
    members,
    inviteCode: "K7QX-94TD",
  };
}

// Tournaments

export const MOCK_TOURNAMENT_IDS = [
  "0e2f5a8c-1b3d-4f6e-8a9b-0c1d2e3f4a01",
  "0e2f5a8c-1b3d-4f6e-8a9b-0c1d2e3f4a02",
  "0e2f5a8c-1b3d-4f6e-8a9b-0c1d2e3f4a03",
  "0e2f5a8c-1b3d-4f6e-8a9b-0c1d2e3f4a04",
  "0e2f5a8c-1b3d-4f6e-8a9b-0c1d2e3f4a05",
  "0e2f5a8c-1b3d-4f6e-8a9b-0c1d2e3f4a06",
];

const FORMAT: TournamentSummary["format"] = {
  type: "single_elimination",
  bestOf: { default: 1, semis: 1, final: 3 },
};

function summary(
  i: number,
  name: string,
  mode: Mode,
  cadence: "daily" | "weekly",
  status: TournamentSummary["status"],
  startOffsetH: number,
  entrants: number,
  max: number,
): TournamentSummary {
  const startsAt = new Date(MOCK_NOW + startOffsetH * 3_600_000).toISOString();
  return {
    id: MOCK_TOURNAMENT_IDS[i]!,
    cupKey: `${cadence}-${mode}`,
    name,
    mode,
    cadence,
    status,
    startsAt,
    startedAt: status === "open" ? null : startsAt,
    completedAt: status === "completed" ? new Date(MOCK_NOW + (startOffsetH + 2) * 3_600_000).toISOString() : null,
    maxEntrants: max,
    entrantCount: entrants,
    minTrust: "verified",
    entryFee: 0,
    format: FORMAT,
    checkIn: false,
    winnerEntryId: null,
  };
}

export const MOCK_TOURNAMENTS: TournamentSummary[] = [
  summary(0, "Daily Rush Cup", "rush3v3", "daily", "open", 2, 11, 16),
  summary(1, "Daily Aim Cup", "aim1v1", "daily", "running", -1, 16, 16),
  summary(2, "Weekly Rush Cup", "rush3v3", "weekly", "open", 72, 23, 32),
  summary(3, "Weekly Aim Cup", "aim1v1", "weekly", "completed", -144, 8, 16),
  summary(4, "Daily Rush Cup", "rush3v3", "daily", "completed", -48, 12, 16),
  summary(5, "Daily Duo Aim Cup", "aim2v2", "daily", "cancelled", -216, 3, 16),
];

function mockEntries(t: TournamentSummary): EntryView[] {
  const r = rng(hash(t.id));
  const size = t.mode === "aim1v1" ? 1 : t.mode === "aim2v2" ? 2 : 3;
  return Array.from({ length: t.entrantCount }, (_, i) => {
    const players = Array.from({ length: size }, (_, j) => {
      const u = mockUser(i * size + j + 1);
      const rating = Math.round(2250 - i * 40 - r() * 160);
      return { steamId: u.steamId, displayName: u.displayName, avatarUrl: null, rating, tier: tierForRating(rating).id };
    });
    return {
      id: `${t.id.slice(0, 24)}${String(i).padStart(12, "0")}`,
      captainSteamId: players[0]!.steamId,
      steamIds: players.map((p) => p.steamId),
      seed: t.status === "open" ? null : i + 1,
      rating: Math.round(players.reduce((n, p) => n + p.rating, 0) / players.length),
      registeredAt: new Date(MOCK_NOW - (i + 1) * 3_600_000).toISOString(),
      name: size === 1 ? players[0]!.displayName : `Team ${players[0]!.displayName}`,
      players,
    };
  });
}

function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

function mockBracket(t: TournamentSummary, entries: EntryView[]): Bracket {
  let size = 2;
  while (size < entries.length) size *= 2;
  const rounds = Math.log2(size);
  const r = rng(hash(t.id + "bracket"));
  const bySeed = (seed: number) => entries[seed - 1]?.id ?? null;
  const matches: BracketMatch[] = [];
  const order = seedOrder(size);
  const completedRounds = t.status === "completed" ? rounds : 1;

  let prevWinners: (string | null)[] = [];
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round;
    const winners: (string | null)[] = [];
    const bestOf = round === rounds ? t.format.bestOf.final : round === rounds - 1 ? t.format.bestOf.semis : 1;
    for (let index = 0; index < count; index++) {
      const aSeed = round === 1 ? order[index * 2]! : null;
      const bSeed = round === 1 ? order[index * 2 + 1]! : null;
      const a = round === 1 ? bySeed(aSeed!) : prevWinners[index * 2] ?? null;
      const b = round === 1 ? bySeed(bSeed!) : prevWinners[index * 2 + 1] ?? null;
      const known = round === 1 || round <= completedRounds + 1;
      const bye = round === 1 && (!a || !b);
      const done = bye || (round <= completedRounds && !!a && !!b);
      const live = !done && round === completedRounds + 1 && !!a && !!b && index === 0 && t.status === "running";
      let winner: string | null = null;
      const games: BracketMatch["games"] = [];
      if (bye) winner = a ?? b;
      else if (done) {
        const aWins = r() > 0.35;
        winner = aWins ? a : b;
        const need = Math.ceil(bestOf / 2);
        for (let g = 0; g < need; g++) games.push({ matchId: mockUuid(`${t.id}-${round}-${index}-${g}`), winner: aWins ? "a" : "b" });
        if (bestOf > 1) games.splice(1, 0, { matchId: mockUuid(`${t.id}-${round}-${index}-x`), winner: aWins ? "b" : "a" });
      }
      winners.push(winner);
      matches.push({
        id: `r${round}m${index}`,
        round,
        index,
        bestOf,
        a: known ? a : null,
        b: known ? b : null,
        aSeed: round === 1 && a ? aSeed : null,
        bSeed: round === 1 && b ? bSeed : null,
        aResolved: round === 1 || !!a,
        bResolved: round === 1 || !!b,
        status: done ? "done" : live ? "live" : a && b ? "ready" : "pending",
        games,
        liveMatchId: live ? MOCK_LIVE_MATCH_ID : null,
        winner,
        resolution: bye ? "bye" : done ? "played" : null,
      });
    }
    prevWinners = winners;
  }
  return { size, rounds, matches };
}

// Bumped by the mock realtime client to simulate bracket changes
const mockBracketVersions = new Map<string, number>();

export function mockBracketVersion(id: string): number {
  return mockBracketVersions.get(id) ?? 1;
}

export function bumpMockBracketVersion(id: string): number {
  const v = mockBracketVersion(id) + 1;
  mockBracketVersions.set(id, v);
  return v;
}

export function mockTournamentDetail(id: string): TournamentDetail | null {
  const t = MOCK_TOURNAMENTS.find((x) => x.id === id);
  if (!t) return null;
  const entries = mockEntries(t);
  const bracket = t.status === "running" || t.status === "completed" ? mockBracket(t, entries) : null;
  const final = bracket?.matches.find((m) => m.round === bracket.rounds);
  return {
    ...t,
    winnerEntryId: t.status === "completed" ? final?.winner ?? null : null,
    entries,
    bracket,
    bracketVersion: mockBracketVersion(id),
    myEntryId: null,
  };
}
