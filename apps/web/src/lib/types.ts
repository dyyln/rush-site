// REST response shapes the web expects from the api.
// WS payloads and config come from @rushsite/shared. These cover the HTTP side.
import type { Mode, TierId, TrustLevel } from "@rushsite/shared";

export type { Mode, TierId, TrustLevel };

export type User = {
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  trustLevel: TrustLevel;
  region: string;
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

// Tournament shapes mirror apps/api/src/modules/tournaments/types.ts

export type TournamentStatus = "open" | "running" | "completed" | "cancelled";
export type CupCadence = "daily" | "weekly";

export type TournamentSummary = {
  id: string;
  cupKey: string;
  name: string;
  mode: Mode;
  cadence: CupCadence;
  status: TournamentStatus;
  startsAt: string;
  startedAt: string | null;
  completedAt: string | null;
  maxEntrants: number;
  entrantCount: number;
  minTrust: TrustLevel;
  entryFee: number;
  format: { type: "single_elimination"; bestOf: { default: number; semis: number; final: number } };
  checkIn: false;
  winnerEntryId: string | null;
};

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

export type BracketSide = "a" | "b";
export type BracketMatchStatus = "pending" | "ready" | "live" | "done";
export type BracketResolution = "played" | "bye" | "walkover" | "forfeit" | "double_forfeit" | "void";

export type BracketMatch = {
  id: string;
  round: number;
  index: number;
  bestOf: number;
  // Entry ids
  a: string | null;
  b: string | null;
  aSeed: number | null;
  bSeed: number | null;
  aResolved: boolean;
  bResolved: boolean;
  status: BracketMatchStatus;
  games: { matchId: string; winner: BracketSide }[];
  liveMatchId: string | null;
  // Entry id
  winner: string | null;
  resolution: BracketResolution | null;
};

export type Bracket = {
  size: number;
  rounds: number;
  matches: BracketMatch[];
};

export type TournamentDetail = TournamentSummary & {
  entries: EntryView[];
  bracket: Bracket | null;
  myEntryId: string | null;
};
