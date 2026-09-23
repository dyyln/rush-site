import type { Mode, ServiceStatus, TierDistribution } from "@rushsite/shared";
import { api } from "@/lib/api";
import { isMock } from "@/lib/env";
import { mockCall } from "@/lib/mock";
import type { Leaderboard } from "@/lib/types";
import { mockDistribution, mockFriendsLeaderboard, mockStatus } from "./mock";

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

export const statsApi = {
  async status(): Promise<ServiceStatus> {
    if (isMock) return mockCall(mockStatus, 200);
    return api.get<ServiceStatus>("/status");
  },
  async distribution(mode: Mode): Promise<TierDistribution> {
    if (isMock) return mockCall(() => mockDistribution(mode), 200);
    return api.get<TierDistribution>(`/leaderboard/${mode}/distribution`);
  },
  async friendsLeaderboard(mode: Mode): Promise<FriendsLeaderboard> {
    if (isMock) return mockCall(() => mockFriendsLeaderboard(mode), 200);
    return api.get<FriendsLeaderboard>(`/leaderboard/${mode}/friends`);
  },
};
