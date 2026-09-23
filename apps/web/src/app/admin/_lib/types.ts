// Mirrors the response shapes in apps/api/src/modules/admin/types.ts
import type { AdminEventKind, Mode, TrustLevel } from "@rushsite/shared";

export type { AdminEventKind, Mode, TrustLevel };

export type UserCard = { steamId: string; displayName: string; avatarUrl: string | null };

export type QueueTicketView = {
  id: string;
  partyId: string;
  modes: Mode[];
  size: number;
  players: UserCard[];
  rating: number | null;
  region: string;
  enqueuedAt: string;
  waitSec: number;
};

export type QueueView = {
  generatedAt: string;
  modes: { mode: Mode; players: number; tickets: QueueTicketView[] }[];
  totalTickets: number;
  totalPlayers: number;
};

export type MatchSummaryView = {
  id: string;
  mode: Mode;
  status: string;
  source: string;
  region: string;
  teams: { name: string; players: UserCard[] }[];
  mapId: string | null;
  hostId: string | null;
  server: { ip: string; port: number; connect: string | null } | null;
  winnerTeam: string | null;
  score: Record<string, number> | null;
  tournamentId: string | null;
  cancelReason: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type MatchPlayerView = UserCard & {
  team: number;
  accepted: boolean | null;
  connected: boolean | null;
  abandoned: boolean | null;
  won: boolean | null;
  kills: number | null;
  deaths: number | null;
  headshots: number | null;
  damage: number | null;
};

export type MatchDetailView = MatchSummaryView & {
  maps: string[] | null;
  acceptDeadline: string | null;
  readyAt: string | null;
  players: MatchPlayerView[];
  rounds: { round: number; winnerTeam: string; score: Record<string, number>; arena: string | null }[];
};

export type HostView = {
  id: string;
  name: string;
  publicIp: string | null;
  status: string;
  cs2Version: string | null;
  updating: boolean;
  slots: { total: number; free: number; used: number };
  lastSeenAt: string | null;
  servers: { slotIndex: number; port: number | null; status: string; matchId: string | null }[];
};

export type EventView = {
  id: string;
  kind: "webhook" | "error";
  at: string;
  type: string;
  message: string;
  matchId: string | null;
  ok: boolean;
  detail: unknown;
};

export type AuditAction = "queue.remove" | "match.cancel" | "user.ban" | "user.unban" | "user.trust";

export type AuditEntry = {
  id: string;
  adminSteamId: string;
  action: AuditAction;
  target: string;
  payload: unknown;
  createdAt: string;
};

export type BanView = {
  id: string;
  reason: string;
  bannedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
};

export type UserDetailView = {
  user: UserCard & {
    region: string;
    countryCode: string | null;
    profileUrl: string | null;
    createdAt: string;
    lastLoginAt: string;
  };
  steam: {
    personaName: string;
    accountCreatedAt: string | null;
    cs2PlaytimeMinutes: number | null;
    communityVisibility: number | null;
    fetchedAt: string;
  } | null;
  trust: { level: TrustLevel; reason: string; locked: boolean; updatedAt: string } | null;
  trustSignals: { id: string; source: string; clean: boolean; data: unknown; fetchedAt: string }[];
  ratings: { mode: Mode; rating: number; rd: number; matchesPlayed: number; wins: number; losses: number; updatedAt: string }[];
  recentMatches: {
    id: string;
    mode: Mode;
    status: string;
    team: number;
    won: boolean | null;
    abandoned: boolean;
    kills: number | null;
    deaths: number | null;
    score: Record<string, number> | null;
    mapId: string | null;
    createdAt: string;
  }[];
  bans: BanView[];
  activeBan: BanView | null;
  cooldowns: { reason: string; endsAt: string; offence: number }[];
  reports: { received: number; open: number };
  flags: { open: number; total: number };
  audit: AuditEntry[];
};

export type Health = { ok: boolean; latencyMs: number | null; error?: string };

export type OverviewView = {
  generatedAt: string;
  queue: { mode: Mode; tickets: number; players: number; longestWaitSec: number }[];
  matches: { active: number; byStatus: Record<string, number>; finished24h: number; abandoned24h: number };
  hosts: { total: number; online: number; updating: number; slotsTotal: number; slotsFree: number };
  users: { total: number; new24h: number };
  moderation: { activeBans: number; openReports: number; openFlags: number };
  events: { errorsLastHour: number; webhooksLastHour: number; failedWebhooksLastHour: number };
  health: { db: Health; redis: Health; queue: Health; matches: Health; hosts: Health; events: Health };
};

export type ActionResult = { ok: true; audit: AuditEntry };
