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

// Modes the server switched off, such as a test queue, are left out so the site hides them
export function visibleStatus(s: ServiceStatus): ServiceStatus {
  return { ...s, modes: s.modes.filter((m) => m.reason !== "disabled") };
}

// Registered players and matches played to the end
export type SiteTotals = { players: number; matches: number };

export const statsApi = {
  async totals(): Promise<SiteTotals> {
    if (isMock) return mockCall(() => ({ players: 1284, matches: 5317 }), 200);
    return api.get<SiteTotals>("/stats/totals");
  },
  async status(): Promise<ServiceStatus> {
    return visibleStatus(isMock ? await mockCall(mockStatus, 200) : await api.get<ServiceStatus>("/status"));
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
