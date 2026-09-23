import { describe, expect, it } from "vitest"
import { MatchEventSchema, MatchReportBodySchema } from "./index.js"

const A = "76561198000000001"
const B = "76561198000000011"

describe("kill event", () => {
  it("parses the plugin shape", () => {
    const kill = { type: "kill", round: 2, tick: 6400, attacker: A, victim: B, weapon: "ak47", headshot: true, wallbang: false, assister: A }
    expect(MatchEventSchema.parse(kill)).toEqual(kill)
    const { assister: _, ...noAssist } = kill
    expect(MatchEventSchema.parse(noAssist)).toEqual(noAssist)
  })

  it("rejects bad kills", () => {
    const base = { type: "kill", round: 1, tick: 1, attacker: A, victim: B, weapon: "awp", headshot: false, wallbang: true }
    expect(() => MatchEventSchema.parse({ ...base, round: 0 })).toThrow()
    expect(() => MatchEventSchema.parse({ ...base, attacker: "bot" })).toThrow()
    expect(() => MatchEventSchema.parse({ ...base, weapon: "" })).toThrow()
    expect(() => MatchEventSchema.parse({ ...base, wallbang: undefined })).toThrow()
  })
})

describe("report body", () => {
  it("accepts the listed reasons only", () => {
    expect(MatchReportBodySchema.parse({ steamId: A, reason: "wallhack", note: " prefire " })).toEqual({ steamId: A, reason: "wallhack", note: "prefire" })
    expect(() => MatchReportBodySchema.parse({ steamId: A, reason: "toxic" })).toThrow()
    expect(() => MatchReportBodySchema.parse({ steamId: A, reason: "other", note: "x".repeat(501) })).toThrow()
  })
})
