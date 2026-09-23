// Mock match pages. One live match that gains a round every few seconds, the rest finished
import { AIM_MAPS, RUSH_MAP, RUSH_ROOMS, tierForRating, type Mode } from "@rushsite/shared";
import { MOCK_TOURNAMENT_IDS, mockUser } from "./mock";
import type { MatchDetail, MatchPlayer, MatchRound, MatchTeam } from "./types";

export const MOCK_LIVE_MATCH_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000a1";
export const MOCK_DONE_MATCH_ID = "7a1e0c52-9b1d-4c7e-8f00-0000000000b2";

export const MOCK_ROUND_MS = 3000;

// Lets mock history rows open a match page with the same mode and map
export const MOCK_MATCH_HINTS = new Map<string, { mode: Mode; mapId: string }>();
const LIVE_START = Date.now();
const LIVE_START_ROUNDS = 9;

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

const MIDS = RUSH_ROOMS.midRooms.map((r) => r.displayName);

// Plays out a whole match from a seed. Aim is first to 16, Rush first to 8 of 15
function playOut(mode: Mode, seed: number): { winners: number[]; arenas: string[] } {
  const r = rng(seed);
  const target = mode === "rush3v3" ? 8 : 16;
  const score = [0, 0];
  const winners: number[] = [];
  const arenas: string[] = [];
  const bias = 0.45 + r() * 0.15;
  let room = 3;
  while (score[0]! < target && score[1]! < target) {
    const w = r() < bias ? 0 : 1;
    score[w]!++;
    winners.push(w);
    if (mode === "rush3v3") {
      arenas.push(room === 0 ? RUSH_ROOMS.castles.t.displayName : room === 6 ? RUSH_ROOMS.castles.ct.displayName : room === 3 ? RUSH_ROOMS.startRooms[Math.floor(r() * 4)]!.displayName : MIDS[Math.floor(r() * MIDS.length)]!);
      room = Math.max(0, Math.min(6, room + (w === 0 ? 1 : -1)));
      if (score[0] === 7 && score[1] === 7) room = -1;
    }
  }
  return { winners, arenas };
}

function players(mode: Mode, seed: number, offset: number, rounds: number, meFirst = false): MatchPlayer[] {
  const r = rng(seed + offset);
  const size = mode === "aim1v1" ? 1 : mode === "aim2v2" ? 2 : 3;
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
function build(id: string, mode: Mode, mapId: string, seed: number, roundsPlayed: number | null, startedAt: number, meOnB = false): MatchDetail {
  const plan = playOut(mode, seed);
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
      arena: mode === "rush3v3" ? plan.arenas[i] ?? RUSH_ROOMS.decider.displayName : undefined,
      endedAt: new Date(startedAt + (i + 1) * 60_000).toISOString(),
    });
  }
  const done = n === plan.winners.length;
  const teams: MatchTeam[] = names.map((name, i) => ({
    name,
    score: score[name]!,
    players: players(mode, seed, i * 10, n, meOnB && i === 1),
  }));
  return {
    id,
    mode,
    mapId,
    status: done ? "finished" : "live",
    driver: "hetzner",
    startedAt: new Date(startedAt).toISOString(),
    endedAt: done ? new Date(startedAt + (n + 1) * 60_000).toISOString() : null,
    teams,
    rounds,
  };
}

export function mockMatchDetail(id: string, now = Date.now()): MatchDetail {
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
  if (id === MOCK_DONE_MATCH_ID) return build(id, "rush3v3", RUSH_MAP.id, 7, null, now - 3 * 3_600_000);
  const seed = hash(id);
  const modes: Mode[] = ["aim1v1", "aim2v2", "rush3v3"];
  const hint = MOCK_MATCH_HINTS.get(id);
  const mode = hint?.mode ?? modes[seed % 3]!;
  const mapId = hint?.mapId ?? (mode === "rush3v3" ? RUSH_MAP.id : AIM_MAPS[seed % AIM_MAPS.length]!.id);
  return build(id, mode, mapId, seed, null, now - (seed % 72) * 3_600_000);
}
