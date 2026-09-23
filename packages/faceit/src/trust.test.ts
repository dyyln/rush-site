import { describe, expect, it } from "vitest"
import { signalToTrustDelta } from "./index.js"
import type { FaceitSignal } from "./index.js"

const base: FaceitSignal = { faceitId: "x", nickname: "n", banned: false, pastBans: 0, fetchedAt: "2026-09-23T00:00:00Z" }

describe("signalToTrustDelta", () => {
  it("is neutral with no account", () => {
    expect(signalToTrustDelta(null)).toBe(0)
    expect(signalToTrustDelta(undefined)).toBe(0)
  })

  it("is strongly negative when banned regardless of matches", () => {
    expect(signalToTrustDelta({ ...base, banned: true, matchesPlayed: 5000 })).toBe(-100)
  })

  it("is mildly negative with past bans even with long history", () => {
    expect(signalToTrustDelta({ ...base, pastBans: 1, matchesPlayed: 5000 })).toBe(-25)
    expect(signalToTrustDelta({ ...base, pastBans: 2 }, { pastBanDelta: -10 })).toBe(-10)
  })

  it("scales mildly with clean match history", () => {
    expect(signalToTrustDelta({ ...base })).toBe(0)
    expect(signalToTrustDelta({ ...base, matchesPlayed: 99 })).toBe(0)
    expect(signalToTrustDelta({ ...base, matchesPlayed: 100 })).toBe(5)
    expect(signalToTrustDelta({ ...base, matchesPlayed: 500 })).toBe(10)
  })

  it("accepts custom weights", () => {
    const opts = { bannedDelta: -50, experienceSteps: [{ minMatches: 10, delta: 1 }] }
    expect(signalToTrustDelta({ ...base, banned: true }, opts)).toBe(-50)
    expect(signalToTrustDelta({ ...base, matchesPlayed: 10 }, opts)).toBe(1)
  })
})
