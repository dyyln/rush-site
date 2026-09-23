import type { TrustStatus } from "./trust";

// REST response shapes the web expects from the api.
// WS payloads and config come from @rushsite/shared. These cover the HTTP side.
import type {
  BracketMatchView,
  MatchDetail as SharedMatchDetail,
  MatchDetailPlayer,
  MatchDetailTeam,
  MatchRound as SharedMatchRound,
  MatchStatus as SharedMatchStatus,
  MatchUpdatePayload,
  BracketView,
  EntryPlayer as SharedEntryPlayer,
  TournamentDetail as SharedTournamentDetail,
  TournamentEntry,
  TournamentBracketResponse,
  Kill,
  MatchDemo as SharedMatchDemo,
  MatchExtras as SharedMatchExtras,
  MatchMvp as SharedMatchMvp,
  Mode,
  MvpReason as SharedMvpReason,
  ReportReason as SharedReportReason,
  TierId,
  TournamentStatus as SharedTournamentStatus,
  TournamentSummary as SharedTournamentSummary,
  TrustLevel,
} from "@rushsite/shared";

export type { Mode, TierId, TrustLevel };

// Matchmaking preferences on GET /me, changed with PATCH /me/settings
export type UserSettings = { minTrust: TrustLevel };

export type User = {
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  trustLevel: TrustLevel;
  region: string;
  // Only set on GET /me
  isAdmin?: boolean;
  trust?: TrustStatus;
  settings?: UserSettings;
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

export type EntryPlayer = SharedEntryPlayer;
export type EntryView = TournamentEntry;

export type BracketMatch = BracketMatchView;
export type Bracket = BracketView;
export type BracketMatchStatus = BracketMatch["status"];

export type TournamentDetail = SharedTournamentDetail;

export type TournamentBracket = TournamentBracketResponse;

// Match page types come from @rushsite/shared
export type MatchStatus = SharedMatchStatus;
export type MatchPlayer = MatchDetailPlayer;
export type MatchTeam = MatchDetailTeam;
export type MatchRound = SharedMatchRound;
export type MatchDetail = SharedMatchDetail & MatchExtras;
export type MatchUpdate = MatchUpdatePayload;

// Match extras from GET /matches/:id. Optional so older api responses still render
export type ReportReason = SharedReportReason;
export type MatchKill = Kill;
export type MatchMvp = SharedMatchMvp;
export type MvpReason = SharedMvpReason;
export type MatchDemo = SharedMatchDemo;

export type MatchExtras = Partial<SharedMatchExtras> & {
  // Per player rating change once the match is rated. Keyed by steamId. Not in the contract yet
  ratingDeltas?: Record<string, number>;
  // steamIds the signed-in viewer already reported in this match
  viewerReported?: string[];
};
