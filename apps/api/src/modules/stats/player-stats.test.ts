import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, createTestDb, makeUsers } from "../../../test/helpers.js"
import { matchKills, matchPlayers, matches } from "../../db/schema.js"

describe("profile streaks and favourite weapon", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>

  beforeAll(async () => {
    h = await createAppHarness()
  })
  afterAll(async () => {
    await h.close()
  })
  beforeEach(async () => {
    await createTestDb()
    await h.redis.flushall()
  })

  async function played(steamId: string, other: string, mode: "aim1v1" | "aim2v2", result: "win" | "loss" | "abandoned", minute: number) {
    const at = new Date(Date.UTC(2026, 8, 1, 12, minute))
    const [m] = await h.db
      .insert(matches)
      .values({
        mode,
        status: result === "abandoned" ? "abandoned" : "finished",
        teams: [
          { name: "A", steamIds: [steamId] },
          { name: "B", steamIds: [other] },
        ],
        webhookSecret: "s",
        createdAt: at,
        endedAt: at,
      })
      .returning()
    await h.db.insert(matchPlayers).values([
      { matchId: m!.id, steamId, team: 0, won: result === "win", abandoned: result === "abandoned" },
      { matchId: m!.id, steamId: other, team: 1, won: result !== "win" },
    ])
    return m!.id
  }

  it("computes per mode streaks in time order", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    // Inserted out of order to prove the ordering is by time
    await played(a!, b!, "aim1v1", "win", 5)
    await played(a!, b!, "aim1v1", "win", 1)
    await played(a!, b!, "aim1v1", "win", 2)
    await played(a!, b!, "aim1v1", "loss", 3)
    await played(a!, b!, "aim1v1", "win", 4)
    await played(a!, b!, "aim2v2", "win", 1)
    await played(a!, b!, "aim2v2", "abandoned", 2)
    await played(a!, b!, "aim2v2", "loss", 3)

    const profile = (await h.app.inject({ method: "GET", url: `/users/${a}/profile` })).json()
    const streak = (mode: string) => profile.modes.find((m: { mode: string }) => m.mode === mode).streak
    expect(streak("aim1v1")).toEqual({ current: 2, longest: 2 })
    expect(streak("aim2v2")).toEqual({ current: -2, longest: 1 })
    expect(streak("rush3v3")).toEqual({ current: 0, longest: 0 })
    expect(profile.favouriteWeapon).toBeNull()
  })

  it("picks the weapon with the most kills and skips team kills", async () => {
    const [a, b, c] = await makeUsers(h.db, 3)
    const id = await played(a!, b!, "aim1v1", "win", 1)
    await h.db.insert(matchPlayers).values({ matchId: id, steamId: c!, team: 0 })
    const kill = (tick: number, weapon: string, victim = b!) => ({
      matchId: id,
      round: 1,
      tick,
      attackerSteamId: a!,
      victimSteamId: victim,
      weapon,
      headshot: false,
      wallbang: false,
    })
    await h.db
      .insert(matchKills)
      .values([kill(1, "ak47"), kill(2, "ak47"), kill(3, "deagle"), kill(4, "deagle", c!), kill(5, "deagle", c!), kill(6, "deagle", c!)])

    const profile = (await h.app.inject({ method: "GET", url: `/users/${a}/profile` })).json()
    expect(profile.favouriteWeapon).toEqual({ weapon: "ak47", kills: 2 })
    const other = (await h.app.inject({ method: "GET", url: `/users/${b}/profile` })).json()
    expect(other.favouriteWeapon).toBeNull()
  })
})
