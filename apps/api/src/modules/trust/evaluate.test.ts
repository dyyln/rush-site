import { describe, expect, it } from "vitest"
import { evaluateTrust, type TrustInputs } from "./evaluate.js"

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
