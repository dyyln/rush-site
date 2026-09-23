// Deterministic mock data for the stats pages
import { TIERS, tierForRating, type Mode, type ServiceStatus, type TierDistribution } from "@rushsite/shared";
import { MOCK_ME, MOCK_NOW, mockLeaderboard } from "@/lib/mock";
import type { FriendsLeaderboard } from "./statsApi";

// Rough bell curve per mode, low to high tiers
const COUNTS: Record<Mode, number[]> = {
  aim1v1: [412, 1380, 2210, 1490, 610, 138],
  aim2v2: [288, 904, 1502, 1011, 402, 77],
  rush3v3: [520, 1720, 2640, 1702, 655, 121],
};
const MY_RATING: Record<Mode, number> = { aim1v1: 1742, aim2v2: 1486, rush3v3: 1918 };

export function mockDistribution(mode: Mode): TierDistribution {
  const counts = COUNTS[mode];
  const total = counts.reduce((s, n) => s + n, 0);
  const rating = MY_RATING[mode];
  const tier = tierForRating(rating);
  const idx = TIERS.findIndex((t) => t.id === tier.id);
  // Everyone in lower tiers plus a share of your own tier by position in the band
  const within = tier.min !== null && tier.max !== null ? (rating - tier.min) / (tier.max - tier.min) : 0.5;
  const below = counts.slice(0, idx).reduce((s, n) => s + n, 0) + Math.round(counts[idx]! * within);
  return {
    mode,
    total,
    tiers: TIERS.map((t, i) => ({ tier: t.id, count: counts[i]!, pct: counts[i]! / total })),
    you: { tier: tier.id, rating, percentile: Math.round((below / total) * 1000) / 10, placed: true },
  };
}

export function mockFriendsLeaderboard(mode: Mode): FriendsLeaderboard {
  const global = mockLeaderboard(mode, 0, 240).rows;
  const picks = global.filter((_, i) => i % 23 === 7).slice(0, 8);
  const me = {
    rank: 0,
    steamId: MOCK_ME.steamId,
    displayName: MOCK_ME.displayName,
    avatarUrl: null,
    rating: MY_RATING[mode],
    tier: tierForRating(MY_RATING[mode]).id,
    matches: 146,
    wins: 81,
  };
  const unplaced = [
    { ...global[200]!, rating: 1388, tier: tierForRating(1388).id, matches: 7, wins: 4 },
    { ...global[220]!, rating: 1512, tier: tierForRating(1512).id, matches: 12, wins: 5 },
  ];
  let rank = 0;
  const rows = [
    ...[...picks, me].sort((a, b) => b.rating - a.rating).map((r) => ({ ...r, rank: ++rank, placed: true })),
    ...unplaced.sort((a, b) => b.rating - a.rating).map((r) => ({ ...r, rank: null, placed: false })),
  ];
  return { mode, total: rows.length, rows, friendsAvailable: true };
}

export function mockStatus(): ServiceStatus {
  return {
    regions: [{ region: "eu", hosts: 2, hostsOnline: 2, slotsTotal: 24, slotsFree: 9, updating: false }],
    surge: { enabled: true, active: 1 },
    modes: [
      { mode: "aim1v1", available: true },
      { mode: "aim2v2", available: true },
      { mode: "rush3v3", available: false, reason: "not_configured" },
    ],
    updatedAt: new Date(MOCK_NOW).toISOString(),
  };
}
