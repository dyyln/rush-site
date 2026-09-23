import type { FlagStatus, MyReport, ReviewDecideBody, ReviewDecideResponse, ReviewFlag, ReviewListResponse } from "@rushsite/shared";
import { ApiError } from "@/lib/api";
import { MOCK_ME, mockMatchDetail } from "@/lib/mock";

const MATCH_IDS = ["7b1f3c2e-0d4a-4e8b-9a61-3f2c1d0e9a01", "7b1f3c2e-0d4a-4e8b-9a61-3f2c1d0e9a02", "7b1f3c2e-0d4a-4e8b-9a61-3f2c1d0e9a03"];

function build(i: number): ReviewFlag {
  const m = mockMatchDetail(MATCH_IDS[i]!, Date.parse("2026-09-23T12:00:00Z"));
  const [a, b] = m.teams;
  const suspect = b!.players[0]!;
  const reporters = a!.players.length > 1 ? a!.players.slice(0, 2) : a!.players;
  const created = new Date(Date.now() - (i + 1) * 3_600_000).toISOString();
  return {
    id: `f1a90000-0000-4000-8000-00000000000${i + 1}`,
    status: "open",
    source: "reports",
    createdAt: created,
    decidedAt: null,
    reviewer: null,
    note: null,
    player: {
      steamId: suspect.steamId,
      displayName: suspect.displayName,
      avatarUrl: suspect.avatarUrl,
      trustLevel: i === 0 ? "new" : "verified",
      banned: false,
      stats: { matches: 14 + i, wins: 12, kills: 300, deaths: 90, headshots: 210, kd: 3.33, headshotPct: 0.7, rating: suspect.rating },
      history: { reportsReceived: 3 + i, flagsConfirmed: 0, flagsCleared: i },
    },
    match: {
      id: m.id,
      mode: m.mode,
      mapId: m.mapId,
      status: m.status,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      flaggedTeam: 1,
      teams: m.teams.map((t) => ({
        name: t.name,
        score: t.score,
        players: t.players.map((p) => ({ ...p, damage: p.damage })),
      })),
    },
    reports: reporters.map((r, j) => ({
      id: `a1a90000-0000-4000-8000-0000000000${i}${j}`,
      reporter: { steamId: r.steamId, displayName: r.displayName, avatarUrl: r.avatarUrl, trustLevel: j === 0 ? "trusted" : "new" },
      reason: j === 0 ? "aimbot" : "wallhack",
      note: j === 0 ? "Snaps to heads through smoke every round" : null,
      outcome: "received",
      createdAt: created,
    })),
  };
}

let store: ReviewFlag[] | null = null;
const flags = () => (store ??= MATCH_IDS.map((_, i) => build(i)));

function find(id: string): ReviewFlag {
  const f = flags().find((x) => x.id === id);
  if (!f) throw new ApiError(404, "flag_not_found", "Flag not found");
  return f;
}

export function mockList(status: FlagStatus | "all"): ReviewListResponse {
  const counts: Record<FlagStatus, number> = { open: 0, reviewing: 0, cleared: 0, confirmed: 0 };
  for (const f of flags()) counts[f.status]++;
  return { flags: flags().filter((f) => status === "all" || f.status === status), counts };
}

export const mockFlag = (id: string) => find(id);

export function mockClaim(id: string): ReviewFlag {
  const f = find(id);
  if (f.status === "open") {
    f.status = "reviewing";
    f.reviewer = { steamId: MOCK_ME.steamId, displayName: MOCK_ME.displayName, avatarUrl: MOCK_ME.avatarUrl };
    f.reports.forEach((r) => (r.outcome = "reviewed"));
  }
  return f;
}

export function mockDecide(id: string, body: ReviewDecideBody): ReviewDecideResponse {
  const f = find(id);
  if (f.status === "cleared" || f.status === "confirmed") throw new ApiError(409, "already_decided", "This case is already decided");
  f.status = body.outcome;
  f.note = body.note;
  f.decidedAt = new Date().toISOString();
  f.reviewer ??= { steamId: MOCK_ME.steamId, displayName: MOCK_ME.displayName, avatarUrl: MOCK_ME.avatarUrl };
  f.reports.forEach((r) => (r.outcome = body.outcome === "confirmed" ? "actioned" : "dismissed"));
  if (body.outcome === "confirmed" && body.ban) f.player.banned = true;
  return {
    flag: f,
    reportsUpdated: f.reports.length,
    banId: body.outcome === "confirmed" && body.ban ? "mock-ban" : null,
    rollback: body.outcome === "confirmed" ? { voidedMatches: 3, playersAdjusted: 6 } : null,
  };
}

export function mockMyReports(matchId?: string): MyReport[] {
  const outcomes = ["received", "reviewed", "actioned", "dismissed"] as const;
  const rows: MyReport[] = MATCH_IDS.map((id, i) => {
    const m = mockMatchDetail(id, Date.parse("2026-09-23T12:00:00Z"));
    const target = m.teams[1]!.players[0]!;
    const outcome = outcomes[i % outcomes.length]!;
    return {
      id: `b1a90000-0000-4000-8000-00000000000${i}`,
      matchId: id,
      reported: { steamId: target.steamId, displayName: target.displayName, avatarUrl: target.avatarUrl },
      reason: i === 1 ? "wallhack" : "aimbot",
      note: null,
      outcome,
      createdAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
      decidedAt: outcome === "actioned" || outcome === "dismissed" ? new Date(Date.now() - i * 3_600_000).toISOString() : null,
      match: { mode: m.mode, mapId: m.mapId, endedAt: m.endedAt },
    };
  });
  return matchId ? rows.filter((r) => r.matchId === matchId) : rows;
}
