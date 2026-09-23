import { describe, expect, it } from "vitest"
import { evaluateTrust, trustLevels, trustProgress, type TrustInputs } from "./evaluate.js"

const NOW = Date.parse("2026-09-23T12:00:00Z")
const cfg = { verifiedMinMatches: 5, trustedMinMatches: 150, trustedMinAccountDays: 365, banGraceDays: 1825 }
const cleanBans = {
  SteamId: "1",
  CommunityBanned: false,
  VACBanned: false,
  NumberOfVACBans: 0,
  DaysSinceLastBan: 0,
  NumberOfGameBans: 0,
  EconomyBan: "none",
}
const base = (over: Partial<TrustInputs> = {}, platform: Partial<TrustInputs["platform"]> = {}): TrustInputs => ({
  steamBans: cleanBans,
  accountCreatedAt: new Date(NOW - 3 * 365 * 86400_000),
  cs2PlaytimeMinutes: 500 * 60,
  faceit: null,
  ...over,
  platform: { completedMatches: 10, openFlags: 0, confirmedFlags: 0, activeBan: false, ...platform },
})

describe("evaluateTrust", () => {
  it("starts New until enough clean matches", () => {
    expect(evaluateTrust(base({}, { completedMatches: 2 }), cfg, NOW).level).toBe("new")
    expect(evaluateTrust(base(), cfg, NOW).level).toBe("verified")
  })

  it("treats no FACEIT account and an unreachable FACEIT as neutral", () => {
    expect(evaluateTrust(base({ faceit: null }), cfg, NOW).level).toBe("verified")
    expect(evaluateTrust(base({ faceit: "unknown" }), cfg, NOW).level).toBe("verified")
  })

  it("blocks Verified on an unchecked Steam status only when the check is required", () => {
    expect(evaluateTrust(base({ steamBans: "unknown" }), cfg, NOW).level).toBe("verified")
    expect(evaluateTrust(base({ steamBans: "unknown" }), { ...cfg, requireSteamCheck: true }, NOW).level).toBe("new")
  })

  it("keeps a FACEIT or recent Steam ban at New", () => {
    const faceit = { faceitId: "x", nickname: "x", banned: true, pastBans: 1, fetchedAt: "" }
    expect(evaluateTrust(base({ faceit }), cfg, NOW).level).toBe("new")
    const vac = { ...cleanBans, VACBanned: true, NumberOfVACBans: 1, DaysSinceLastBan: 30 }
    expect(evaluateTrust(base({ steamBans: vac }), cfg, NOW).level).toBe("new")
  })

  it("lets an old Steam ban reach Verified but not Trusted", () => {
    const old = { ...cleanBans, VACBanned: true, NumberOfVACBans: 1, DaysSinceLastBan: 4000 }
    expect(evaluateTrust(base({ steamBans: old }, { completedMatches: 500 }), cfg, NOW).level).toBe("verified")
  })

  it("reaches Trusted with a long clean history", () => {
    expect(evaluateTrust(base({}, { completedMatches: 200 }), cfg, NOW).level).toBe("trusted")
    const pastFaceit = { faceitId: "x", nickname: "x", banned: false, pastBans: 1, fetchedAt: "" }
    expect(evaluateTrust(base({ faceit: pastFaceit }, { completedMatches: 200 }), cfg, NOW).level).toBe("verified")
  })

  it("drops to New on open flags or a platform ban", () => {
    expect(evaluateTrust(base({}, { openFlags: 1 }), cfg, NOW).level).toBe("new")
    expect(evaluateTrust(base({}, { activeBan: true }), cfg, NOW).level).toBe("new")
  })
})

describe("trustProgress", () => {
  it("counts matches toward Verified with the configured threshold", () => {
    const p = trustProgress("new", base({}, { completedMatches: 3 }), cfg, NOW)
    expect(p.next).toBe("verified")
    expect(p.requirements.find((r) => r.key === "matches")).toEqual({
      key: "matches",
      label: "Finish 5 matches without abandoning",
      met: false,
      progress: { current: 3, required: 5 },
    })
    expect(p.requirements.every((r) => r.key === "matches" || r.met)).toBe(true)
  })

  it("agrees with the evaluator when every requirement is met", () => {
    const input = base({}, { completedMatches: 5 })
    const p = trustProgress("new", input, cfg, NOW)
    expect(p.requirements.every((r) => r.met)).toBe(true)
    expect(evaluateTrust(input, cfg, NOW).level).not.toBe("new")
  })

  it("names the blocker when a ban stops promotion", () => {
    const vac = { ...cleanBans, VACBanned: true, NumberOfVACBans: 1, DaysSinceLastBan: 30 }
    const p = trustProgress("new", base({ steamBans: vac }), cfg, NOW)
    expect(p.blockedBy).toBe("steam_recent_ban")
    expect(p.requirements.find((r) => r.key === "steam_check")!.met).toBe(false)
    expect(trustProgress("verified", base(), cfg, NOW, { locked: true }).blockedBy).toBe("admin_locked")
  })

  it("tracks account age and match count toward Trusted", () => {
    const young = base({ accountCreatedAt: new Date(NOW - 100 * 86400_000) }, { completedMatches: 40 })
    const p = trustProgress("verified", young, cfg, NOW)
    expect(p.next).toBe("trusted")
    expect(p.requirements.find((r) => r.key === "account_age")).toMatchObject({ met: false, progress: { current: 100, required: 365 } })
    expect(p.requirements.find((r) => r.key === "matches")).toMatchObject({ met: false, progress: { current: 40, required: 150 } })
  })

  it("has nothing left at Trusted", () => {
    expect(trustProgress("trusted", base(), cfg, NOW)).toEqual({ level: "trusted", next: null, requirements: [] })
  })

  it("puts the live thresholds in the level definitions", () => {
    const defs = trustLevels({ ...cfg, verifiedMinMatches: 8 })
    expect(defs.thresholds.verifiedMinMatches).toBe(8)
    expect(defs.levels[1]!.requirements.find((r) => r.key === "matches")!.required).toBe(8)
  })
})
