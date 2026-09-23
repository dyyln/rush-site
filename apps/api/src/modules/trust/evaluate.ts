import { signalToTrustDelta, type FaceitSignal } from "@rushsite/faceit"
import type { TrustLevel, TrustLevelsResponse, TrustProgress } from "@rushsite/shared"
import type { SteamBans } from "../auth/steam.js"

export type Unknown = "unknown"

export type TrustInputs = {
  // null means Steam returned nothing for the account. unknown means we could not ask
  steamBans: SteamBans | null | Unknown
  accountCreatedAt: Date | null
  cs2PlaytimeMinutes: number | null
  // null means no FACEIT account, which is neutral
  faceit: FaceitSignal | null | Unknown
  platform: {
    completedMatches: number
    openFlags: number
    confirmedFlags: number
    activeBan: boolean
  }
}

export type TrustConfig = {
  verifiedMinMatches: number
  trustedMinMatches: number
  trustedMinAccountDays: number
  // A Steam ban older than this no longer blocks Verified
  banGraceDays: number
  // When set, an unchecked Steam ban status keeps the player at New. On in production
  requireSteamCheck?: boolean
}

export type TrustEvaluation = {
  level: TrustLevel
  score: number
  reasons: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

// Weights on one scale. FACEIT weights are passed through to the faceit package
export const TRUST_WEIGHTS = {
  steamActiveBan: -100,
  steamOldBan: -25,
  communityBan: -50,
  accountYear: 5,
  playtime100h: 5,
  faceit: { bannedDelta: -100, pastBanDelta: -25 },
}

export function steamBanCount(b: SteamBans): number {
  return (b.VACBanned ? Math.max(1, b.NumberOfVACBans) : b.NumberOfVACBans) + b.NumberOfGameBans
}

// Every rule in one place so the evaluator and the progress view never disagree
export type TrustChecks = {
  score: number
  reasons: string[]
  // Blockers that keep a player at New whatever else they do
  hardBlock: string | null
  steamVerifiedOk: boolean
  steamTrustedOk: boolean
  faceitVerifiedOk: boolean
  faceitTrustedOk: boolean
  cleanHistory: boolean
  completedMatches: number
  accountDays: number | null
}

export function trustChecks(input: TrustInputs, cfg: TrustConfig, now: number): TrustChecks {
  const reasons: string[] = []
  let score = 0
  let hardBlock: string | null = null
  let steamVerifiedOk = true
  let steamTrustedOk = true
  let faceitVerifiedOk = true
  let faceitTrustedOk = true

  if (input.platform.activeBan) {
    reasons.push("platform_ban")
    hardBlock = "platform_ban"
    score = -1000
  }

  const bans = input.steamBans
  if (bans === "unknown") {
    reasons.push("steam_unchecked")
    steamTrustedOk = false
    if (cfg.requireSteamCheck) steamVerifiedOk = false
  } else if (bans) {
    const count = steamBanCount(bans)
    if (bans.CommunityBanned) {
      score += TRUST_WEIGHTS.communityBan
      steamVerifiedOk = false
      steamTrustedOk = false
      hardBlock ??= "steam_community_ban"
      reasons.push("steam_community_ban")
    }
    if (count > 0) {
      steamTrustedOk = false
      if (bans.DaysSinceLastBan <= cfg.banGraceDays) {
        score += TRUST_WEIGHTS.steamActiveBan
        steamVerifiedOk = false
        hardBlock ??= "steam_recent_ban"
        reasons.push("steam_recent_ban")
      } else {
        score += TRUST_WEIGHTS.steamOldBan
        reasons.push("steam_old_ban")
      }
    }
  }

  const faceit = input.faceit
  if (faceit === "unknown") {
    reasons.push("faceit_unchecked")
  } else if (faceit === null) {
    reasons.push("faceit_none")
  } else {
    score += signalToTrustDelta(faceit, TRUST_WEIGHTS.faceit)
    if (faceit.banned) {
      faceitVerifiedOk = false
      faceitTrustedOk = false
      hardBlock ??= "faceit_banned"
      reasons.push("faceit_banned")
    } else if (faceit.pastBans > 0) {
      faceitTrustedOk = false
      reasons.push("faceit_past_ban")
    }
  }

  const accountDays = input.accountCreatedAt ? (now - input.accountCreatedAt.getTime()) / DAY_MS : null
  if (accountDays !== null && accountDays >= 365) score += TRUST_WEIGHTS.accountYear
  if (input.cs2PlaytimeMinutes !== null && input.cs2PlaytimeMinutes >= 100 * 60) score += TRUST_WEIGHTS.playtime100h

  const p = input.platform
  if (p.confirmedFlags > 0) {
    hardBlock ??= "confirmed_flag"
    reasons.push("confirmed_flag")
  }
  if (p.openFlags > 0) reasons.push("open_flag")
  const cleanHistory = p.confirmedFlags === 0 && p.openFlags === 0 && !p.activeBan

  return {
    score,
    reasons,
    hardBlock,
    steamVerifiedOk,
    steamTrustedOk,
    faceitVerifiedOk,
    faceitTrustedOk,
    cleanHistory,
    completedMatches: p.completedMatches,
    accountDays,
  }
}

export function evaluateTrust(input: TrustInputs, cfg: TrustConfig, now: number): TrustEvaluation {
  const c = trustChecks(input, cfg, now)
  const reasons = [...c.reasons]
  if (input.platform.activeBan) return { level: "new", score: c.score, reasons: ["platform_ban"] }
  if (!c.steamVerifiedOk || !c.faceitVerifiedOk || !c.cleanHistory) return { level: "new", score: c.score, reasons }
  if (c.completedMatches < cfg.verifiedMinMatches) {
    reasons.push("needs_matches")
    return { level: "new", score: c.score, reasons }
  }
  const trustedOk =
    c.steamTrustedOk &&
    c.faceitTrustedOk &&
    c.completedMatches >= cfg.trustedMinMatches &&
    c.accountDays !== null &&
    c.accountDays >= cfg.trustedMinAccountDays &&
    c.score >= 0
  return { level: trustedOk ? "trusted" : "verified", score: c.score, reasons }
}

// What the player still needs for the next level, from the same checks the evaluator uses
export function trustProgress(
  level: TrustLevel,
  input: TrustInputs,
  cfg: TrustConfig,
  now: number,
  opts: { locked?: boolean } = {},
): TrustProgress {
  const c = trustChecks(input, cfg, now)
  const next = level === "new" ? "verified" : level === "verified" ? "trusted" : null
  const out: TrustProgress = { level, next, requirements: [] }
  if (next === "verified") {
    out.requirements = [
      { key: "steam_check", label: "Steam account has no active VAC, game or community ban", met: c.steamVerifiedOk },
      { key: "faceit_check", label: "No active FACEIT ban. No FACEIT account is fine", met: c.faceitVerifiedOk },
      {
        key: "matches",
        label: `Finish ${cfg.verifiedMinMatches} matches without abandoning`,
        met: c.completedMatches >= cfg.verifiedMinMatches,
        progress: { current: Math.min(c.completedMatches, cfg.verifiedMinMatches), required: cfg.verifiedMinMatches },
      },
      { key: "clean_history", label: "No open or confirmed fair play flags", met: c.cleanHistory },
    ]
  } else if (next === "trusted") {
    const days = c.accountDays === null ? 0 : Math.floor(c.accountDays)
    out.requirements = [
      { key: "steam_check", label: "Steam account has never been banned", met: c.steamTrustedOk },
      { key: "faceit_check", label: "No current or past FACEIT ban", met: c.faceitTrustedOk },
      {
        key: "matches",
        label: `Finish ${cfg.trustedMinMatches} matches`,
        met: c.completedMatches >= cfg.trustedMinMatches,
        progress: { current: Math.min(c.completedMatches, cfg.trustedMinMatches), required: cfg.trustedMinMatches },
      },
      {
        key: "account_age",
        label: `Steam account at least ${cfg.trustedMinAccountDays} days old and visible on your public profile`,
        met: c.accountDays !== null && c.accountDays >= cfg.trustedMinAccountDays,
        progress: { current: Math.min(days, cfg.trustedMinAccountDays), required: cfg.trustedMinAccountDays },
      },
      { key: "clean_history", label: "Clean history with no flags or negative trust signals", met: c.cleanHistory && c.score >= 0 },
    ]
  }
  const blockedBy = opts.locked ? "admin_locked" : c.hardBlock
  if (blockedBy && next) out.blockedBy = blockedBy
  return out
}

// Level definitions with the live thresholds, for GET /trust/levels
export function trustLevels(cfg: TrustConfig): TrustLevelsResponse {
  return {
    levels: [
      { level: "new", label: "New", description: "Every account starts here. Ladder play is open to everyone.", requirements: [] },
      {
        level: "verified",
        label: "Verified",
        description: "Required for every cup. Earned automatically.",
        requirements: [
          { key: "steam_check", label: "Steam account has no active VAC, game or community ban" },
          { key: "faceit_check", label: "No active FACEIT ban. No FACEIT account is fine" },
          { key: "matches", label: "Finished matches without abandoning", required: cfg.verifiedMinMatches },
          { key: "clean_history", label: "No open or confirmed fair play flags" },
        ],
      },
      {
        level: "trusted",
        label: "Trusted",
        description: "A long clean history. Unlocks reviewing and faster holds later.",
        requirements: [
          { key: "steam_check", label: "Steam account has never been banned" },
          { key: "faceit_check", label: "No current or past FACEIT ban" },
          { key: "matches", label: "Finished matches", required: cfg.trustedMinMatches },
          { key: "account_age", label: "Steam account age in days", required: cfg.trustedMinAccountDays },
          { key: "clean_history", label: "Clean history with no flags or negative trust signals" },
        ],
      },
    ],
    thresholds: {
      verifiedMinMatches: cfg.verifiedMinMatches,
      trustedMinMatches: cfg.trustedMinMatches,
      trustedMinAccountDays: cfg.trustedMinAccountDays,
      banGraceDays: cfg.banGraceDays,
    },
  }
}
