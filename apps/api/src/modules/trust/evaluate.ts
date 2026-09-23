import { signalToTrustDelta, type FaceitSignal } from "@rushsite/faceit"
import type { TrustLevel } from "@rushsite/shared"
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

export function evaluateTrust(input: TrustInputs, cfg: TrustConfig, now: number): TrustEvaluation {
  const reasons: string[] = []
  let score = 0
  let blocksVerified = false
  let blocksTrusted = false

  if (input.platform.activeBan) {
    return { level: "new", score: -1000, reasons: ["platform_ban"] }
  }

  const bans = input.steamBans
  if (bans === "unknown") {
    reasons.push("steam_unchecked")
    blocksTrusted = true
  } else if (bans) {
    const count = steamBanCount(bans)
    if (bans.CommunityBanned) {
      score += TRUST_WEIGHTS.communityBan
      blocksVerified = true
      reasons.push("steam_community_ban")
    }
    if (count > 0) {
      blocksTrusted = true
      if (bans.DaysSinceLastBan <= cfg.banGraceDays) {
        score += TRUST_WEIGHTS.steamActiveBan
        blocksVerified = true
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
      blocksVerified = true
      reasons.push("faceit_banned")
    } else if (faceit.pastBans > 0) {
      blocksTrusted = true
      reasons.push("faceit_past_ban")
    }
  }

  const accountDays = input.accountCreatedAt ? (now - input.accountCreatedAt.getTime()) / DAY_MS : null
  if (accountDays !== null && accountDays >= 365) score += TRUST_WEIGHTS.accountYear
  if (input.cs2PlaytimeMinutes !== null && input.cs2PlaytimeMinutes >= 100 * 60) score += TRUST_WEIGHTS.playtime100h

  const p = input.platform
  if (p.confirmedFlags > 0) {
    blocksVerified = true
    reasons.push("confirmed_flag")
  }
  if (p.openFlags > 0) {
    blocksVerified = true
    reasons.push("open_flag")
  }

  if (blocksVerified) return { level: "new", score, reasons }
  if (p.completedMatches < cfg.verifiedMinMatches) {
    reasons.push("needs_matches")
    return { level: "new", score, reasons }
  }
  const trustedOk =
    !blocksTrusted &&
    p.completedMatches >= cfg.trustedMinMatches &&
    accountDays !== null &&
    accountDays >= cfg.trustedMinAccountDays &&
    score >= 0
  return { level: trustedOk ? "trusted" : "verified", score, reasons }
}
