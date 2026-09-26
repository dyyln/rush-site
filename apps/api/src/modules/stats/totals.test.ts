import { describe, expect, it } from "vitest"
import { createAppHarness, makeUsers, startDuel } from "../../../test/helpers.js"

describe("site totals", () => {
  it("counts players and finished matches", async () => {
    const h = await createAppHarness()
    try {
      await makeUsers(h.db, 3)
      const { matchId } = await startDuel(h)
      await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
      await h.ctx.flow.handleEvent(matchId, { type: "match_started" })
      await h.ctx.flow.handleEvent(matchId, { type: "match_end", winnerTeam: "A", score: { A: 13, B: 2 }, players: [], demoUploaded: false })
      const res = await h.app.inject({ method: "GET", url: "/stats/totals" })
      // startDuel adds its own two players
      expect(res.json()).toEqual({ players: 5, matches: 1 })
    } finally {
      await h.close()
    }
  })
})
