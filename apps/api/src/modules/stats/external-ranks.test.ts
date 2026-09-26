import { describe, expect, it } from "vitest"
import { createAppHarness, makeUsers } from "../../../test/helpers.js"
import { trustSignals } from "../../db/schema.js"

function leetify(answers: Record<string, unknown>, calls: string[]) {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const id = new URL(url).searchParams.get("steam64_id")!
    const body = answers[id]
    if (body === undefined) return new Response("Not Found", { status: 404 })
    if (body === "down") return new Response("oops", { status: 502 })
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

describe("external ranks", () => {
  it("merges Leetify ranks with our FACEIT lookup and caches the answer", async () => {
    const calls: string[] = []
    const answers: Record<string, unknown> = {}
    const h = await createAppHarness({ fetch: leetify(answers, calls) })
    try {
      const [a, b] = await makeUsers(h.db, 2)
      answers[a!] = { privacy_mode: "public", ranks: { premier: 15234, wingman: 17, faceit: 8, faceit_elo: 1700 } }
      await h.db.insert(trustSignals).values({
        steamId: a!,
        source: "faceit",
        clean: true,
        data: { faceitId: "f1", nickname: "shooter", skillLevel: 10, elo: 2400, banned: false, pastBans: 0, fetchedAt: "" },
      })
      const res = await h.app.inject({ method: "GET", url: `/users/${a}/ranks` })
      expect(res.json()).toEqual({
        faceit: { level: 10, elo: 2400, nickname: "shooter" },
        premier: 15234,
        wingman: 17,
        leetify: { url: `https://leetify.com/app/profile/${a}` },
      })
      await h.app.inject({ method: "GET", url: `/users/${a}/ranks` })
      expect(calls.filter((u) => u.includes(a!))).toHaveLength(1)

      // Not on Leetify and no FACEIT
      expect((await h.app.inject({ method: "GET", url: `/users/${b}/ranks` })).json()).toEqual({
        faceit: null,
        premier: null,
        wingman: null,
        leetify: null,
      })
      expect((await h.app.inject({ method: "GET", url: "/users/76561198000000999/ranks" })).statusCode).toBe(404)
    } finally {
      await h.close()
    }
  })

  it("falls back to Leetify's FACEIT level and survives an outage", async () => {
    const calls: string[] = []
    const answers: Record<string, unknown> = {}
    const h = await createAppHarness({ fetch: leetify(answers, calls) })
    try {
      const [a, b] = await makeUsers(h.db, 2)
      answers[a!] = { ranks: { premier: null, wingman: 0, faceit: 4, faceit_elo: 1010 } }
      answers[b!] = "down"
      expect((await h.app.inject({ method: "GET", url: `/users/${a}/ranks` })).json()).toMatchObject({
        faceit: { level: 4, elo: 1010, nickname: null },
        premier: null,
        wingman: null,
      })
      const down = await h.app.inject({ method: "GET", url: `/users/${b}/ranks` })
      expect(down.statusCode).toBe(200)
      expect(down.json()).toMatchObject({ leetify: null, premier: null })
    } finally {
      await h.close()
    }
  })
})
