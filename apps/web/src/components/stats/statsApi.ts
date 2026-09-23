import type { LiveMatch, LiveMatches, Mode, ServiceStatus, TierDistribution } from "@rushsite/shared";
import { api } from "@/lib/api";
import { isMock } from "@/lib/env";
import type { Leaderboard } from "@/lib/types";
import { mockDistribution, mockFriendsLeaderboard, mockLiveMatches, mockStatus } from "./mock";

export type FriendRow = Omit<Leaderboard["rows"][number], "rank"> & {
  // Position among placed friends. null while unplaced
  rank: number | null;
  placed: boolean;
};

export type FriendsLeaderboard = Omit<Leaderboard, "rows"> & {
  rows: FriendRow[];
  friendsAvailable: boolean;
  reason?: "steam_api_disabled" | "friends_private";
};

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

async function mocked<T>(value: T): Promise<T> {
  await delay();
  return structuredClone(value);
}

export const statsApi = {
  async status(): Promise<ServiceStatus> {
    if (isMock) return mocked(mockStatus());
    return api.get<ServiceStatus>("/status");
  },
  async distribution(mode: Mode): Promise<TierDistribution> {
    if (isMock) return mocked(mockDistribution(mode));
    return api.get<TierDistribution>(`/leaderboard/${mode}/distribution`);
  },
  async friendsLeaderboard(mode: Mode): Promise<FriendsLeaderboard> {
    if (isMock) return mocked(mockFriendsLeaderboard(mode));
    return api.get<FriendsLeaderboard>(`/leaderboard/${mode}/friends`);
  },
  async liveMatches(limit = 6): Promise<LiveMatch[]> {
    if (isMock) return mocked(mockLiveMatches(limit));
    return (await api.get<LiveMatches>("/matches/live", { limit })).matches;
  },
};
