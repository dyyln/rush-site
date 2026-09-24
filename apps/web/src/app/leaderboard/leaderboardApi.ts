// Leaderboard reads with name search and the viewer's rank. Mock mode places you mid table
import type { Mode } from "@rushsite/shared";
import { api } from "@/lib/api";
import { isMock } from "@/lib/env";
import { MOCK_ME, mockCall, mockLeaderboard } from "@/lib/mock";
import type { Leaderboard } from "@/lib/types";

export type MyRank = {
  mode: Mode;
  placed: boolean;
  // Global rank and the offset of the page that holds it. null while unplaced
  rank: number | null;
  offset: number | null;
  limit: number;
  matches: number;
  needed: number;
};

// Short queries match the name prefix, longer ones match anywhere. Same rule as the api
export const CONTAINS_MIN_LEN = 3;

const MOCK_MY_RANK: Record<Mode, number> = { aim1v1: 137, aim2v2: 61, rush3v3: 98, rush1v1: 1, rush2v2: 1 };

function mockBoard(mode: Mode): Leaderboard {
  const board = mockLeaderboard(mode, 0, 1000);
  const i = MOCK_MY_RANK[mode] - 1;
  const row = board.rows[i]!;
  board.rows[i] = { ...row, steamId: MOCK_ME.steamId, displayName: MOCK_ME.displayName };
  return board;
}

function mockSearch(mode: Mode, offset: number, limit: number, q?: string): Leaderboard {
  const board = mockBoard(mode);
  const needle = q?.trim().toLowerCase();
  const rows = needle
    ? board.rows.filter((r) => {
        const name = r.displayName.toLowerCase();
        return needle.length < CONTAINS_MIN_LEN ? name.startsWith(needle) : name.includes(needle);
      })
    : board.rows;
  return { mode, total: rows.length, rows: rows.slice(offset, offset + limit) };
}

export const leaderboardApi = {
  async list(mode: Mode, opts: { offset: number; limit: number; q?: string }): Promise<Leaderboard> {
    const q = opts.q?.trim() || undefined;
    if (isMock) return mockCall(() => mockSearch(mode, opts.offset, opts.limit, q));
    return api.get<Leaderboard>(`/leaderboard/${mode}`, { offset: opts.offset, limit: opts.limit, q });
  },
  async me(mode: Mode, limit: number): Promise<MyRank> {
    if (isMock) {
      const rank = MOCK_MY_RANK[mode];
      return mockCall(() => ({
        mode,
        placed: true,
        rank,
        offset: Math.floor((rank - 1) / limit) * limit,
        limit,
        matches: 146,
        needed: 0,
      }));
    }
    return api.get<MyRank>(`/leaderboard/${mode}/me`, { limit });
  },
};
