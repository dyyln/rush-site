// Deterministic mock data so server and client renders match.
import {
  AIM_MAPS,
  isRushMode,
  MODES,
  RANKED_MODES,
  RUSH_MAP,
  RUSH_ROOMS,
  RUSH_SERIES_ROOM_VETO,
  createSeriesRoomVeto,
  seriesRushRoomsFromVeto,
  tierForRating,
  type MatchMap,
  type Mode,
  type PartyUpdatePayload,
  type VetoState,
} from "@rushsite/shared";
import { teamSize } from "./modes";
import { MOCK_TRUST } from "./trust";
import type {
  Bracket,
  BracketMatch,
  EntryView,
  Leaderboard,
  LeaderboardRow,
  MatchDetail,
  MatchHistoryPage,
  MatchKill,
  MatchPlayer,
  MatchRound,
  MatchSummary,
  MatchTeam,
  ModeStats,
  Profile,
  TournamentDetail,
  TournamentSummary,
  User,
} from "./types";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const mockDelay = (ms = 250) => new Promise<void>((r) => setTimeout(r, ms));

// Waits like a network call and returns a copy so callers cannot change mock state
export async function mockCall<T>(fn: () => T, ms = 250): Promise<T> {
  await mockDelay(ms);
  return structuredClone(fn());
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
  trustLevel: "new",
  region: "eu",
  isAdmin: true,
  trust: MOCK_TRUST,
  settings: { minTrust: "new" },
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

const BASE_RATING: Record<Mode, number> = { aim1v1: 2480, aim2v2: 2390, rush3v3: 2310, rush1v1: 1500 };

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
  // Older points walk back from the first one so the history covers 90 days
  const back = rng(hash(steamId + mode + "older"));
  let older = history[0]!.rating;
  for (let ts = history[0]!.ts - DAY * 1.1; ts > MOCK_NOW - 90 * DAY; ts -= DAY * (0.6 + back() * 1.2)) {
    older -= (back() - 0.45) * 45;
    history.unshift({ ts: Math.round(ts), rating: Math.round(older) });
  }
  const matches = 40 + Math.floor(r() * 200);
  const wins = Math.floor(matches * (0.45 + r() * 0.15));
  const maps = isRushMode(mode) ? [RUSH_MAP] : AIM_MAPS;
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
    streak: { current: Math.floor(r() * 9) - 3, longest: 4 + Math.floor(r() * 8) },
  };
}

function hinted(id: string, mode: Mode, mapId: string): string {
  MOCK_MATCH_HINTS.set(id, { mode, mapId });
  return id;
}

const MOCK_HISTORY = 45;
const MOCK_FIRST_PAGE = 20;

function mockMatches(steamId: string): MatchSummary[] {
  const r = rng(hash(steamId + "matches"));
  return Array.from({ length: MOCK_HISTORY }, (_, i) => {
    const mode = RANKED_MODES[Math.floor(r() * RANKED_MODES.length)]!;
    const aim = !isRushMode(mode);
    const win = r() > 0.45;
    const loserScore = Math.floor(r() * (aim ? 15 : 7));
    const mapId = aim ? AIM_MAPS[Math.floor(r() * AIM_MAPS.length)]!.id : RUSH_MAP.id;
    const kills = 8 + Math.floor(r() * 20);
    const abandoned = i === 7;
    // One Bo3 series so the history shows map scores
    if (i === 2 && aim) {
      const maps = AIM_MAPS.slice(0, 3).map((m) => m.id);
      return {
        matchId: hinted(mockUuid(steamId + i), mode, maps[2]!),
        slug: "brave-amber-falcon",
        mode,
        mapId: maps[2]!,
        bestOf: 3,
        maps,
        playedAt: new Date(MOCK_NOW - i * DAY * 0.6).toISOString(),
        result: win ? "win" : "loss",
        scoreFor: win ? 2 : 1,
        scoreAgainst: win ? 1 : 2,
        ratingDelta: win ? 12 : -12,
        kills: kills * 3,
        deaths: 30,
        headshots: kills,
      };
    }
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

// Offset cursors are fine for the mock. The api uses opaque keyset cursors
export function mockUserMatches(steamId: string, opts: { mode?: Mode; cursor?: string; limit?: number }): MatchHistoryPage {
  const all = mockMatches(steamId).filter((m) => !opts.mode || m.mode === opts.mode);
  const start = Number(opts.cursor ?? 0) || 0;
  const end = start + (opts.limit ?? 20);
  return { matches: all.slice(start, end), nextCursor: end < all.length ? String(end) : null };
}

export function mockProfile(steamId: string): Profile {
  return {
    user: mockUserBySteamId(steamId),
    modes: RANKED_MODES.map((m) => mockModeStats(steamId, m)),
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
    recentMatches: mockMatches(steamId).slice(0, MOCK_FIRST_PAGE),
    recentMatchesCursor: String(MOCK_FIRST_PAGE),
    favouriteWeapon: mockFavouriteWeapon(steamId),
  };
}

function mockFavouriteWeapon(steamId: string): Profile["favouriteWeapon"] {
  const r = rng(hash(steamId + "weapon"));
  const weapons = ["ak47", "m4a1_silencer", "deagle", "awp", "usp_silencer"];
  return { weapon: weapons[Math.floor(r() * weapons.length)]!, kills: 120 + Math.floor(r() * 900) };
}

// Party

export function mockParty(size = 2): PartyUpdatePayload {
  const members = Array.from({ length: size }, (_, i) => {
    const u = mockUser(i === 0 ? 0 : i + 3);
    return { steamId: u.steamId, displayName: u.displayName, avatarUrl: u.avatarUrl, trustLevel: u.trustLevel };
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
  "0e2f5a8c-1b3d-4f6e-8a9b-0c1d2e3f4a07",
];

// Running cup where the mock user has an entry partway through the bracket
const MY_CUP_ID = MOCK_TOURNAMENT_IDS[6]!;
const MY_CUP_SEED = 5;

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
  summary(6, "Weekly Duo Aim Cup", "aim2v2", "weekly", "running", -2, 16, 16),
];

function mockEntries(t: TournamentSummary): EntryView[] {
  const r = rng(hash(t.id));
  const size = teamSize(t.mode);
  return Array.from({ length: t.entrantCount }, (_, i) => {
    const players = Array.from({ length: size }, (_, j) => {
      const u = t.id === MY_CUP_ID && i === MY_CUP_SEED - 1 && j === 0 ? MOCK_ME : mockUser(i * size + j + 1);
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
  const completedRounds = t.status === "completed" ? rounds : t.id === MY_CUP_ID ? 2 : 1;
  const mine = t.id === MY_CUP_ID ? bySeed(MY_CUP_SEED) : null;

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
      const live =
        !done && round === completedRounds + 1 && !!a && !!b && (index === 0 || a === mine || b === mine) && t.status === "running";
      let winner: string | null = null;
      const games: BracketMatch["games"] = [];
      // The last first round pairing of a running cup is won by forfeit
      const forfeited = done && !bye && round === 1 && index === count - 1 && t.status === "running";
      let score: BracketMatch["score"] = null;
      let maps: BracketMatch["maps"];
      if (bye) winner = a ?? b;
      else if (done) {
        const aWins = a === mine ? true : b === mine ? false : r() > 0.35;
        winner = aWins ? a : b;
        if (!forfeited) {
          const need = Math.ceil(bestOf / 2);
          for (let g = 0; g < need; g++) games.push({ matchId: mockUuid(`${t.id}-${round}-${index}-${g}`), winner: aWins ? "a" : "b" });
          if (bestOf > 1) games.splice(1, 0, { matchId: mockUuid(`${t.id}-${round}-${index}-x`), winner: aWins ? "b" : "a" });
          const played = games.map((g) => mockRoundScore(t.mode, g.winner, r));
          if (bestOf > 1) {
            maps = games.map((g, i) => ({ mapNumber: i + 1, mapId: mockCupMap(t.mode, i), status: "done", score: played[i]!, winner: g.winner }));
            score = { a: games.filter((g) => g.winner === "a").length, b: games.filter((g) => g.winner === "b").length };
          } else score = played[0]!;
        }
      }
      if (live) {
        score = bestOf > 1 ? { a: 1, b: 0 } : { a: 5 + Math.floor(r() * 4), b: 3 + Math.floor(r() * 4) };
        if (bestOf > 1) {
          maps = [
            { mapNumber: 1, mapId: mockCupMap(t.mode, 0), status: "done", score: mockRoundScore(t.mode, "a", r), winner: "a" },
            { mapNumber: 2, mapId: mockCupMap(t.mode, 1), status: "live", score: { a: 4, b: 6 }, winner: null },
          ];
        }
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
        resolution: bye ? "bye" : forfeited ? "forfeit" : done ? "played" : null,
        score,
        ...(maps ? { maps } : {}),
        room: live ? MOCK_LIVE_MATCH_ID : (games.at(-1)?.matchId ?? null),
      });
    }
    prevWinners = winners;
  }
  return { size, rounds, matches };
}

// First to 13 in aim with the odd overtime, 8 round wins in Rush
function mockRoundScore(mode: Mode, winner: "a" | "b", r: () => number): { a: number; b: number } {
  const rush = isRushMode(mode);
  const overtime = !rush && r() < 0.15;
  const win = rush ? 8 : overtime ? 16 : 13;
  const lose = rush ? Math.floor(r() * 8) : overtime ? 14 : Math.floor(r() * 12);
  return winner === "a" ? { a: win, b: lose } : { a: lose, b: win };
}

function mockCupMap(mode: Mode, i: number): string {
  return isRushMode(mode) ? RUSH_MAP.id : AIM_MAPS[i % AIM_MAPS.length]!.id;
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
    myEntryId: id === MY_CUP_ID && mockSignedIn() ? mockMyEntryId() : null,
  };
}

function mockMyEntryId(): string {
  const t = MOCK_TOURNAMENTS.find((x) => x.id === MY_CUP_ID)!;
  return mockEntries(t)[MY_CUP_SEED - 1]!.id;
}

// Avatar stack preview and champion for list rows
function enrichMockSummary(t: TournamentSummary) {
  const entries = mockEntries(t);
  t.entrantPreview = entries.slice(0, 5).map((e) => ({ steamId: e.captainSteamId, displayName: e.name ?? e.captainSteamId, avatarUrl: e.players?.[0]?.avatarUrl ?? null }));
  if (t.status === "completed") {
    const bracket = mockBracket(t, entries);
    const winnerId = bracket.matches.find((m) => m.round === bracket.rounds)?.winner;
    const w = entries.find((e) => e.id === winnerId);
    t.winnerEntryId = w?.id ?? null;
    t.winner = w ? { entryId: w.id, name: w.name ?? w.captainSteamId, avatarUrl: w.players?.[0]?.avatarUrl ?? null } : null;
  }
  if (t.id === MY_CUP_ID && typeof window !== "undefined" && mockSignedIn()) t.myEntryId = mockMyEntryId();
}

// Match pages. One live match that gains a round every few seconds, the rest finished
export const MOCK_LIVE_MATCH_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000a1";
export const MOCK_DONE_MATCH_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000b2";
// Live 3v3 Rush that gains a round every few seconds, for the room track
export const MOCK_LIVE_RUSH_MATCH_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000d4";
// Bo3 cup finals on one server: a finished aim final that goes to three maps, and a live Rush final on map 2
export const MOCK_SERIES_AIM_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000e5";
export const MOCK_SERIES_RUSH_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000f6";
// Rush Bo3 cup final in the series room pick before map 1. The mock socket runs the veto, see ws-mock.ts
export const MOCK_SERIES_VETO_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000a7";
export const MOCK_SERIES_VETO_SLUG = "steady-violet-lynx";
// Finished with the viewer playing and no demo uploaded
export const MOCK_NODEMO_MATCH_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000c3";

export const MOCK_ROUND_MS = 3000;

// Lets mock history rows open a match page with the same mode and map
export const MOCK_MATCH_HINTS = new Map<string, { mode: Mode; mapId: string }>();
const LIVE_START = Date.now();
const LIVE_START_ROUNDS = 9;

// Rooms and the team playing CT for one Rush map. Left out, the rooms are drawn from the seed and team 0 plays CT
type RushPlan = { rooms: number[]; ct: 0 | 1 };

// Plays out a whole match from a seed. Aim is first to 13, Rush follows the rush_001 script
function playOut(mode: Mode, seed: number, rush?: RushPlan): { winners: number[]; arenas: string[]; rooms?: number[] } {
  if (isRushMode(mode)) return playOutRush(seed, rush);
  const r = rng(seed);
  const target = 16;
  const score = [0, 0];
  const winners: number[] = [];
  const bias = 0.45 + r() * 0.15;
  while (score[0]! < target && score[1]! < target) {
    const w = r() < bias ? 0 : 1;
    score[w]!++;
    winners.push(w);
  }
  return { winners, arenas: [] };
}

// Team 0 plays CT and team 1 T unless the plan says otherwise, the match.json default. A T win moves play one
// room toward the CT castle. Ends on a win in the enemy castle or 8 wins, with Convoy at 7-7
function playOutRush(seed: number, plan?: RushPlan): { winners: number[]; arenas: string[]; rooms: number[] } {
  const r = rng(seed);
  const mids = [...RUSH_ROOMS.midRooms].sort(() => r() - 0.5).slice(0, 4).map((x) => x.id);
  const start = RUSH_ROOMS.startRooms[Math.floor(r() * RUSH_ROOMS.startRooms.length)]!.id;
  const rooms = plan?.rooms ?? [RUSH_ROOMS.castles.t.id, mids[0]!, mids[1]!, start, mids[2]!, mids[3]!, RUSH_ROOMS.castles.ct.id];
  const tTeam = plan?.ct === 1 ? 0 : 1;
  const bias = 0.4 + r() * 0.2;
  const score = [0, 0];
  const winners: number[] = [];
  const arenas: string[] = [];
  let pos = 3;
  let decider = false;
  for (;;) {
    const w = r() < bias ? 0 : 1;
    // Room ids as the plugin reports them
    arenas.push(decider ? RUSH_ROOMS.decider.id : String(rooms[pos]!));
    winners.push(w);
    score[w]!++;
    if (decider || score[w]! >= 8) break;
    pos += w === tTeam ? 1 : -1;
    if (pos < 0 || pos > 6) break;
    if (score[0] === 7 && score[1] === 7) decider = true;
  }
  return { winners, arenas, rooms };
}

function players(mode: Mode, seed: number, offset: number, rounds: number, meFirst = false): MatchPlayer[] {
  const r = rng(seed + offset);
  const size = teamSize(mode);
  return Array.from({ length: size }, (_, i) => {
    const u = meFirst && i === 0 ? mockUser(0) : mockUser(offset + i + 1);
    const rating = Math.round(1400 + r() * 700);
    const kills = Math.round(rounds * (0.5 + r() * 0.6) / Math.max(1, size - 1 || 1));
    return {
      steamId: u.steamId,
      displayName: u.displayName,
      avatarUrl: null,
      tier: tierForRating(rating).id,
      rating,
      kills,
      deaths: Math.round(rounds * (0.4 + r() * 0.5) / Math.max(1, size - 1 || 1)),
      headshots: Math.round(kills * (0.3 + r() * 0.4)),
      damage: Math.round(kills * (95 + r() * 30)),
    };
  });
}

// meOnB puts the mock viewer on the second team to show own and enemy colours
function build(
  id: string,
  mode: Mode,
  mapId: string,
  seed: number,
  roundsPlayed: number | null,
  startedAt: number,
  meOnB = false,
  demo = true,
  rush?: RushPlan,
): MatchDetail {
  const plan = playOut(mode, seed, rush);
  const n = roundsPlayed === null ? plan.winners.length : Math.min(roundsPlayed, plan.winners.length);
  const names = mode === "aim1v1" ? [mockUser(1).displayName, mockUser(meOnB ? 0 : 11).displayName] : ["Team A", "Team B"];
  const score: Record<string, number> = { [names[0]!]: 0, [names[1]!]: 0 };
  const rounds: MatchRound[] = [];
  for (let i = 0; i < n; i++) {
    const w = names[plan.winners[i]!]!;
    score[w]!++;
    rounds.push({
      round: i + 1,
      winnerTeam: w,
      score: { ...score },
      arena: isRushMode(mode) ? plan.arenas[i] ?? RUSH_ROOMS.decider.id : undefined,
      endedAt: new Date(startedAt + (i + 1) * 60_000).toISOString(),
    });
  }
  const done = n === plan.winners.length;
  const teams: MatchTeam[] = names.map((name, i) => ({
    name,
    score: score[name]!,
    players: players(mode, seed, i * 10, n, meOnB && i === 1),
  }));
  const base: MatchDetail = {
    id,
    mode,
    mapId,
    status: done ? "finished" : "live",
    driver: "hetzner",
    startedAt: new Date(startedAt).toISOString(),
    endedAt: done ? new Date(startedAt + (n + 1) * 60_000).toISOString() : null,
    teams,
    rounds,
    ...(plan.rooms ? { rushRooms: plan.rooms } : {}),
  };
  return { ...base, ...mockMatchExtras(base, seed, { demo }) };
}

// A Bo3 on one server from single map builds. Maps are played until a team has two. live stops at that map
// after that many rounds, and later maps are upcoming. For a finished series the seeds are searched so
// it goes the distance, which shows every part of the series view
function buildSeries(
  id: string,
  mode: Mode,
  mapIds: string[],
  seed: number,
  live: { map: number; rounds: number } | null,
  startedAt: number,
  cup: { id: string; name: string; bracketMatchId: string },
  // Rush: rooms and sides per map from the series room pick
  rushPlans?: RushPlan[],
): MatchDetail {
  let base = seed;
  const winnerOf = (m: MatchDetail) => ([...m.teams].sort((x, y) => y.score - x.score)[0]!.name);
  if (!live) {
    // First seed pair that splits the first two maps
    while (winnerOf(build(id, mode, mapIds[0]!, base, null, startedAt)) === winnerOf(build(id, mode, mapIds[1]!, base + 1, null, startedAt))) base += 2;
  }
  const maps: MatchMap[] = [];
  const all: MatchDetail[] = [];
  const wins: Record<string, number> = {};
  let at = startedAt;
  for (let i = 0; i < mapIds.length; i++) {
    const number = i + 1;
    const decided = Object.values(wins).some((w) => w >= 2);
    const isLive = live?.map === number;
    const upcoming = decided || (live !== null && number > live.map);
    const plan = rushPlans?.[i];
    const m = build(`${id}-map${number}`, mode, mapIds[i]!, base + i, isLive ? live!.rounds : upcoming ? 0 : null, at, false, true, plan);
    const finishedMap = !upcoming && m.status === "finished";
    if (finishedMap) {
      const w = winnerOf(m);
      wins[w] = (wins[w] ?? 0) + 1;
    }
    if (!upcoming) all.push(m);
    maps.push({
      mapNumber: number,
      mapId: mapIds[i]!,
      status: upcoming ? "upcoming" : finishedMap ? "done" : "live",
      winnerTeam: finishedMap ? winnerOf(m) : null,
      score: Object.fromEntries(m.teams.map((t) => [t.name, upcoming ? 0 : t.score])),
      ...(upcoming ? {} : { players: m.teams.flatMap((t) => t.players), demo: finishedMap ? m.demo : undefined }),
      // The series room pick sets every map's rooms and sides before map 1
      ...(plan ? { rushRooms: plan.rooms, ctTeam: m.teams[plan.ct]!.name } : m.rushRooms && !upcoming ? { rushRooms: m.rushRooms } : {}),
    });
    at += (m.rounds.length + 3) * 60_000;
  }
  const first = all[0]!;
  // Series totals: maps won as the score, player stats summed over the maps played
  const teams: MatchTeam[] = first.teams.map((t) => ({
    ...t,
    score: wins[t.name] ?? 0,
    players: t.players.map((p) => {
      const lines = all.flatMap((m) => m.teams.flatMap((x) => x.players)).filter((x) => x.steamId === p.steamId);
      return {
        ...p,
        kills: lines.reduce((n, x) => n + x.kills, 0),
        deaths: lines.reduce((n, x) => n + x.deaths, 0),
        headshots: lines.reduce((n, x) => n + x.headshots, 0),
        damage: lines.reduce((n, x) => n + x.damage, 0),
      };
    }),
  }));
  const done = live === null;
  return {
    ...first,
    id,
    mapId: mapIds[0]!,
    status: done ? "finished" : "live",
    endedAt: done ? new Date(at).toISOString() : null,
    bestOf: 3,
    maps,
    teams,
    rounds: all.flatMap((m, i) => m.rounds.map((r) => ({ ...r, mapNumber: i + 1 }))),
    kills: all.flatMap((m, i) => (m.kills ?? []).map((k) => ({ ...k, mapNumber: i + 1 }))),
    rushRooms: undefined,
    tournament: { ...cup, bestOf: 3, gameNumber: 1 },
    ...(done ? {} : { ratingDeltas: undefined, mvp: undefined }),
  };
}

// Rooms and sides for a Rush Bo3 as the series room pick leaves them: every mid room once, three different
// start rooms, and map 2 swaps the sides of map 1
function seriesRushPlans(seed: number, firstCt: 0 | 1): RushPlan[] {
  const r = rng(seed);
  const mids = [...RUSH_ROOMS.midRooms].sort(() => r() - 0.5).map((x) => x.id);
  const starts = [...RUSH_ROOMS.startRooms].sort(() => r() - 0.5).map((x) => x.id);
  const swapped: 0 | 1 = firstCt === 0 ? 1 : 0;
  return [firstCt, swapped, firstCt].map((ct, i) => ({
    ct,
    rooms: [RUSH_ROOMS.castles.t.id, mids[i * 4]!, mids[i * 4 + 1]!, starts[i]!, mids[i * 4 + 2]!, mids[i * 4 + 3]!, RUSH_ROOMS.castles.ct.id],
  }));
}

// The match the mock socket runs. The room starts at the accept step and the socket moves it on
export const MOCK_ROOM_MATCH_ID = "9d4f1c2a-7b3e-4a5d-8c6f-1e2d3c4b5a69";
export const MOCK_ROOM_SLUG = "brave-amber-falcon";
let mockRoomMode: Mode = "aim1v1";
export function setMockRoomMode(mode: Mode) {
  mockRoomMode = mode;
}

function mockRoomDetail(): MatchDetail {
  const size = teamSize(mockRoomMode);
  const us = [MOCK_ME.steamId, ...Array.from({ length: size - 1 }, (_, i) => mockSteamId(i + 4))];
  const them = Array.from({ length: size }, (_, i) => mockSteamId(i + 20));
  const player = (steamId: string): MatchPlayer => {
    const u = mockUserBySteamId(steamId);
    return { steamId, displayName: u.displayName, avatarUrl: u.avatarUrl, tier: tierForRating(1500).id, rating: 1500, kills: 0, deaths: 0, headshots: 0, damage: 0 };
  };
  const base: MatchDetail = {
    id: MOCK_ROOM_MATCH_ID,
    slug: MOCK_ROOM_SLUG,
    mode: mockRoomMode,
    mapId: null,
    status: "accepting",
    accept: { deadline: Date.now() + 20_000, windowSec: 20, accepted: 0, required: size * 2, responded: false },
    driver: null,
    startedAt: null,
    endedAt: null,
    teams: [
      { name: "team_a", score: 0, players: us.map(player) },
      { name: "team_b", score: 0, players: them.map(player) },
    ],
    rounds: [],
  };
  return { ...base, ...mockMatchExtras(base, 1, { demo: false }) };
}

// Series room pick state for MOCK_SERIES_VETO_ID. The mock socket votes and resolves steps and writes it back here,
// so a refetch sees the same veto. Created on first use, reset by a page load
let seriesVeto: { state: VetoState; stepDeadline: number | null } | null = null;

export function mockSeriesVeto(): { state: VetoState; stepDeadline: number | null } {
  if (!seriesVeto) {
    const size = teamSize("rush3v3");
    const us = [MOCK_ME.steamId, ...Array.from({ length: size - 1 }, (_, i) => mockSteamId(i + 4))];
    const them = Array.from({ length: size }, (_, i) => mockSteamId(i + 20));
    // Team B is the higher seed, so the viewer's team chooses sides on map 1. The flip is fixed so every load
    // reads the same: the viewer's team wins it and chooses sides on map 3 too
    const state = createSeriesRoomVeto(
      [
        { id: "team_a", steamIds: us },
        { id: "team_b", steamIds: them },
      ],
      RUSH_SERIES_ROOM_VETO.format,
      1,
      () => 0.3,
    );
    seriesVeto = { state, stepDeadline: Date.now() + 20_000 };
  }
  return seriesVeto;
}

export function setMockSeriesVeto(state: VetoState, stepDeadline: number | null) {
  seriesVeto = { state, stepDeadline };
}

function mockSeriesVetoDetail(): MatchDetail {
  const { state, stepDeadline } = mockSeriesVeto();
  const player = (steamId: string): MatchPlayer => {
    const u = mockUserBySteamId(steamId);
    return { steamId, displayName: u.displayName, avatarUrl: u.avatarUrl, tier: tierForRating(1700).id, rating: 1700, kills: 0, deaths: 0, headshots: 0, damage: 0 };
  };
  const names = state.teams.map((t) => t.id);
  // Once the veto is done every map carries its rooms and the team playing CT
  const picked = state.done ? seriesRushRoomsFromVeto(state, RUSH_SERIES_ROOM_VETO.format) : [];
  const maps: MatchMap[] = [1, 2, 3].map((n) => {
    const p = picked.find((x) => x.mapNumber === n);
    return {
      mapNumber: n,
      mapId: RUSH_MAP.id,
      status: "upcoming",
      winnerTeam: null,
      score: Object.fromEntries(names.map((x) => [x, 0])),
      ...(p ? { rushRooms: p.rushRooms, ctTeam: names[p.ctTeam]! } : {}),
    };
  });
  return {
    id: MOCK_SERIES_VETO_ID,
    slug: MOCK_SERIES_VETO_SLUG,
    mode: "rush3v3",
    mapId: RUSH_MAP.id,
    status: state.done ? "allocating" : "veto",
    driver: null,
    startedAt: null,
    endedAt: null,
    teams: state.teams.map((t) => ({ name: t.id, score: 0, players: t.steamIds.map(player) })),
    rounds: [],
    bestOf: 3,
    maps,
    tournament: { id: MOCK_TOURNAMENT_IDS[0]!, name: "Daily Rush Cup", bracketMatchId: "final", bestOf: 3, gameNumber: 1 },
    veto: { state: structuredClone(state), stepDeadline, kind: "series-rooms" },
  };
}

export function mockMatchDetail(id: string, now = Date.now()): MatchDetail {
  if (id === MOCK_ROOM_MATCH_ID || id === MOCK_ROOM_SLUG) return mockRoomDetail();
  if (id === MOCK_LIVE_MATCH_ID) {
    // Loops so the demo stays live. Holds the final score for a few rounds before restarting
    const total = playOut("aim1v1", 42).winners.length;
    const cycle = total - LIVE_START_ROUNDS + 4;
    const played = LIVE_START_ROUNDS + (Math.floor((now - LIVE_START) / MOCK_ROUND_MS) % cycle);
    return {
      ...build(id, "aim1v1", "aim_redline", 42, played, LIVE_START - 10 * 60_000, true),
      tournament: { id: MOCK_TOURNAMENT_IDS[1]!, name: "Daily Aim Cup", bracketMatchId: "r4m0", bestOf: 3, gameNumber: 2 },
    };
  }
  if (id === MOCK_LIVE_RUSH_MATCH_ID) {
    // Loops like the live aim match: starts two rounds in and holds the result for a few rounds
    const total = playOut("rush3v3", 5).winners.length;
    const played = 2 + (Math.floor((now - LIVE_START) / MOCK_ROUND_MS) % Math.max(1, total - 2 + 3));
    return build(id, "rush3v3", RUSH_MAP.id, 5, played, LIVE_START - 5 * 60_000, true);
  }
  if (id === MOCK_DONE_MATCH_ID) return build(id, "rush3v3", RUSH_MAP.id, 7, null, now - 3 * 3_600_000);
  if (id === MOCK_SERIES_AIM_ID) {
    return buildSeries(id, "aim2v2", ["aim_redline", "aim_usp", "awp_india"], 300, null, now - 5 * 3_600_000, {
      id: MOCK_TOURNAMENT_IDS[1]!,
      name: "Daily Aim Cup",
      bracketMatchId: "final",
    });
  }
  if (id === MOCK_SERIES_RUSH_ID) {
    // Map 1 done, map 2 live and gaining a round every few seconds like the other live mocks
    const played = 3 + (Math.floor((now - LIVE_START) / MOCK_ROUND_MS) % 12);
    return buildSeries(
      id,
      "rush3v3",
      [RUSH_MAP.id, RUSH_MAP.id, RUSH_MAP.id],
      400,
      { map: 2, rounds: played },
      LIVE_START - 20 * 60_000,
      { id: MOCK_TOURNAMENT_IDS[0]!, name: "Daily Rush Cup", bracketMatchId: "final" },
      // Team B plays CT on map 1, so map 2 draws the CT castle on the left
      seriesRushPlans(400, 1),
    );
  }
  if (id === MOCK_SERIES_VETO_ID || id === MOCK_SERIES_VETO_SLUG) return mockSeriesVetoDetail();
  if (id === MOCK_NODEMO_MATCH_ID) return build(id, "aim2v2", "aim_redline", 19, null, now - 26 * 3_600_000, true, false);
  const seed = hash(id);
  const modes: Mode[] = ["aim1v1", "aim2v2", "rush3v3"];
  const hint = MOCK_MATCH_HINTS.get(id);
  const mode = hint?.mode ?? modes[seed % 3]!;
  const mapId = hint?.mapId ?? (isRushMode(mode) ? RUSH_MAP.id : AIM_MAPS[seed % AIM_MAPS.length]!.id);
  return build(id, mode, mapId, seed, null, now - (seed % 72) * 3_600_000, false, seed % 4 !== 0);
}

// Kills, MVP, rating deltas and demo for match pages. Seeded per round so live refetches stay stable
const AIM_WEAPONS: Record<string, string[]> = {
  aim_usp: ["usp_silencer"],
  aim_deagle7k: ["deagle"],
  awp_india: ["awp"],
};
const AIM_DEFAULT = ["ak47", "ak47", "m4a1_silencer", "deagle", "m4a4"];
const RUSH_WEAPONS = ["ak47", "ak47", "m4a1_silencer", "awp", "mp9", "glock", "usp_silencer", "deagle", "hegrenade", "knife"];
const NO_WALLBANG = new Set(["knife", "hegrenade"]);

const TICK_RATE = 64;

function roundKills(m: MatchDetail, seed: number, roundIndex: number): MatchKill[] {
  const round = m.rounds[roundIndex];
  if (!round) return [];
  const r = rng(seed * 31 + round.round * 7919);
  const winIdx = m.teams.findIndex((t) => t.name === round.winnerTeam);
  const winners = m.teams[winIdx === -1 ? 0 : winIdx]!.players;
  const losers = m.teams[winIdx === 1 ? 0 : 1]!.players;
  const pool = isRushMode(m.mode) ? RUSH_WEAPONS : (AIM_WEAPONS[m.mapId ?? ""] ?? AIM_DEFAULT);
  // Winners kill every loser in aim. In rush tower control can end the round early
  const loserDeaths = isRushMode(m.mode) ? 1 + Math.floor(r() * losers.length) : losers.length;
  const winnerDeaths = Math.floor(r() * winners.length);
  const aliveW = winners.map((p) => p.steamId);
  const aliveL = losers.map((p) => p.steamId);
  const kills: MatchKill[] = [];
  let tick = (round.round - 1) * TICK_RATE * 75 + TICK_RATE * (8 + Math.floor(r() * 12));
  let wLeft = winnerDeaths;
  let lLeft = loserDeaths;
  while (lLeft > 0 || wLeft > 0) {
    // The last kill of the round always goes to the winners
    const loserKill = wLeft > 0 && (lLeft <= 1 ? true : r() < 0.4);
    const atk = loserKill ? aliveL : aliveW;
    const vic = loserKill ? aliveW : aliveL;
    const victimIndex = Math.floor(r() * vic.length);
    const victim = vic[victimIndex]!;
    vic.splice(victimIndex, 1);
    // Now and then a loser dies to a teammate to show team kills
    const tk = !loserKill && vic.length > 0 && r() < 0.08;
    const attacker = tk ? vic[Math.floor(r() * vic.length)]! : atk[Math.floor(r() * atk.length)]!;
    const weapon = pool[Math.floor(r() * pool.length)]!;
    const mates = (tk ? [] : atk).filter((s) => s !== attacker);
    kills.push({
      round: round.round,
      tick,
      attacker,
      victim,
      weapon,
      headshot: weapon !== "hegrenade" && weapon !== "knife" && r() < 0.45,
      wallbang: !NO_WALLBANG.has(weapon) && r() < 0.07,
      assister: mates.length > 0 && r() < 0.3 ? mates[Math.floor(r() * mates.length)] : undefined,
    });
    if (loserKill) wLeft--;
    else lLeft--;
    tick += TICK_RATE * (1 + Math.floor(r() * 9));
  }
  return kills;
}

function mockMatchExtras(m: MatchDetail, seed: number, opts: { demo?: boolean } = {}): Partial<MatchDetail> {
  const kills = m.rounds.flatMap((_, i) => roundKills(m, seed, i));
  const r = rng(seed ^ 0x5bd1e995);
  const teams: MatchTeam[] = m.teams.map((t) => ({
    ...t,
    players: t.players.map((p) => {
      const k = kills.filter((x) => x.attacker === p.steamId);
      const hs = k.filter((x) => x.headshot).length;
      return {
        ...p,
        kills: k.length,
        deaths: kills.filter((x) => x.victim === p.steamId).length,
        headshots: hs,
        damage: Math.round(k.length * (88 + r() * 30) + hs * 6 + r() * 60),
      };
    }),
  }));
  const done = m.status === "finished";
  if (!done) return { teams, kills, mvp: null, demo: { available: false } };

  const everyone = teams.flatMap((t) => t.players);
  const top = [...everyone].sort((a, b) => b.damage - a.damage || b.kills - a.kills)[0];
  const winner = m.teams.reduce((a, b) => (b.score > a.score ? b : a)).name;
  const ratingDeltas: Record<string, number> = {};
  for (const t of teams) {
    for (const p of t.players) {
      const d = 8 + Math.round(r() * 16);
      ratingDeltas[p.steamId] = t.name === winner ? d : -d;
    }
  }
  const available = opts.demo ?? true;
  return {
    teams,
    kills,
    mvp: top ? { steamId: top.steamId, reason: everyone.some((p) => p !== top && p.damage === top.damage) ? "most_kills" : "most_damage" } : null,
    ratingDeltas,
    demo: available
      ? {
          available: true,
          url: `https://demos.rushsite.invalid/matches/${m.id}.dem?X-Amz-Expires=600`,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        }
      : { available: false },
  };
}

// Sign in state, kept per browser. Signed in unless the viewer signed out
const KEY = "rushsite-mock-signed-in";

export function mockSignedIn(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setMockSignedIn(v: boolean) {
  try {
    window.localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    // Storage can be blocked. The mock then stays signed in
  }
}

// Runs last so every mock constant above is initialised
MOCK_TOURNAMENTS.forEach(enrichMockSummary);
