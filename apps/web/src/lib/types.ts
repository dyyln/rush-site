// REST response shapes the web expects from the api.
// WS payloads and config come from @rushsite/shared. These cover the HTTP side.
import type {
  BracketMatchView,
  BracketView,
  Mode,
  TierId,
  TournamentStatus as SharedTournamentStatus,
  TournamentSummary as SharedTournamentSummary,
  TrustLevel,
} from "@rushsite/shared";

export type { Mode, TierId, TrustLevel };

export type User = {
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  trustLevel: TrustLevel;
  region: string;
  // Only set on GET /me
  isAdmin?: boolean;
};

export type RatingPoint = { ts: number; rating: number };

export type MapStat = { mapId: string; matches: number; wins: number };

export type ModeStats = {
  mode: Mode;
  rating: number;
  rd: number;
  tier: TierId;
  matches: number;
  wins: number;
  losses: number;
  headshotPct: number;
  kd: number;
  history: RatingPoint[];
  bestMaps: MapStat[];
  // null until the player has 20 matches in the mode
  leaderboardRank: number | null;
};

export type MatchSummary = {
  matchId: string;
  mode: Mode;
  mapId: string;
  playedAt: string;
  result: "win" | "loss" | "abandoned";
  scoreFor: number;
  scoreAgainst: number;
  ratingDelta: number;
  kills: number;
  deaths: number;
  headshots: number;
};

export type BadgeKind = "cup_champion" | "cup_runner_up" | "cup_semifinalist";

export type ProfileBadge = {
  id: string;
  kind: BadgeKind;
  tournamentId: string;
  tournamentName: string;
  mode: Mode;
  awardedAt: string;
};

export type Profile = {
  user: User;
  modes: ModeStats[];
  badges: ProfileBadge[];
  recentMatches: MatchSummary[];
};

export type LeaderboardRow = {
  rank: number;
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  tier: TierId;
  matches: number;
  wins: number;
};

export type Leaderboard = {
  mode: Mode;
  total: number;
  rows: LeaderboardRow[];
};

// Tournament shapes come from @rushsite/shared

export type TournamentStatus = SharedTournamentStatus;
export type TournamentSummary = SharedTournamentSummary;
export type CupCadence = TournamentSummary["cadence"];

export type EntryPlayer = { steamId: string; displayName: string; avatarUrl: string | null };

export type EntryView = {
  id: string;
  captainSteamId: string;
  steamIds: string[];
  seed: number | null;
  rating: number | null;
  registeredAt: string;
  // Display fields the web needs. Falls back to steamIds when absent
  name?: string;
  players?: EntryPlayer[];
};

export type BracketMatch = BracketMatchView;
export type Bracket = BracketView;
export type BracketMatchStatus = BracketMatch["status"];

export type TournamentDetail = TournamentSummary & {
  entries: EntryView[];
  bracket: Bracket | null;
  myEntryId: string | null;
};
