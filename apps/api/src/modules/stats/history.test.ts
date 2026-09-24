import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, createTestDb, makeUsers } from "../../../test/helpers.js"
import { matchPlayers, matches } from "../../db/schema.js"
import { decodeCursor, encodeCursor } from "./history.js"

describe("paged match history", () => {
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

  async function played(
    a: string,
    b: string,
    opts: { mode?: "aim1v1" | "aim2v2"; at: string; status?: "finished" | "live"; extra?: Partial<typeof matches.$inferInsert> },
  ) {
    const [m] = await h.db
      .insert(matches)
      .values({
        mode: opts.mode ?? "aim1v1",
        status: opts.status ?? "finished",
        teams: [
          { name: "A", steamIds: [a] },
          { name: "B", steamIds: [b] },
        ],
        webhookSecret: "s",
        score: { A: 13, B: 7 },
        ...opts.extra,
      })
      .returning()
    // Raw text keeps microseconds that a JS Date would drop
    await h.db.execute(sql`update ${matches} set created_at = ${opts.at}::timestamptz where ${matches.id} = ${m!.id}`)
    await h.db.insert(matchPlayers).values([
      { matchId: m!.id, steamId: a, team: 0, won: true },
      { matchId: m!.id, steamId: b, team: 1, won: false },
    ])
    return m!.id
  }

  const page = async (steamId: string, query: string) => h.app.inject({ method: "GET", url: `/users/${steamId}/matches?${query}` })

  async function all(steamId: string, query: string): Promise<string[]> {
    const ids: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const res = await page(steamId, `${query}${cursor ? `&cursor=${cursor}` : ""}`)
      expect(res.statusCode).toBe(200)
      const body = res.json() as { matches: { matchId: string }[]; nextCursor: string | null }
      ids.push(...body.matches.map((m) => m.matchId))
      cursor = body.nextCursor
      if (!cursor) break
    }
    return ids
  }

  it("pages newest first without gaps or repeats, even when rows share a timestamp", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    const same = "2026-09-01 12:00:00.000+00"
    const ids = [
      await played(a!, b!, { at: same }),
      await played(a!, b!, { at: same }),
      await played(a!, b!, { at: same }),
      // Same millisecond, different microseconds
      await played(a!, b!, { at: "2026-09-01 12:00:01.000100+00" }),
      await played(a!, b!, { at: "2026-09-01 12:00:01.000900+00" }),
      await played(a!, b!, { at: "2026-09-01 11:00:00+00", mode: "aim2v2" }),
    ]
    await played(a!, b!, { at: "2026-09-01 13:00:00+00", status: "live" })

    const expected = [ids[4]!, ids[3]!, ...[ids[0]!, ids[1]!, ids[2]!].sort().reverse(), ids[5]!]
    for (const limit of [1, 2, 4, 50]) expect(await all(a!, `limit=${limit}`)).toEqual(expected)

    const last = (await page(a!, "limit=6")).json()
    expect(last.matches).toHaveLength(6)
    expect(last.nextCursor).toBeNull()
  })

  it("filters by mode", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    const aim1 = await played(a!, b!, { at: "2026-09-01 12:00:00+00" })
    const aim2 = await played(a!, b!, { at: "2026-09-01 12:05:00+00", mode: "aim2v2" })
    expect(await all(a!, "limit=1&mode=aim1v1")).toEqual([aim1])
    expect(await all(a!, "limit=1&mode=aim2v2")).toEqual([aim2])
    expect(await all(a!, "limit=1")).toEqual([aim2, aim1])
    expect((await page(a!, "mode=chess")).statusCode).toBe(400)
  })

  it("carries the word id and a series score in maps won", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    const id = await played(a!, b!, {
      at: "2026-09-01 12:00:00+00",
      extra: { slug: "brave-amber-falcon", bestOf: 3, maps: ["aim_map", "aim_usp", "awp_india"], mapId: "aim_usp", score: { A: 2, B: 0 } },
    })
    const single = await played(a!, b!, { at: "2026-09-01 11:00:00+00", extra: { mapId: "aim_map" } })
    const { matches: rows } = (await page(a!, "limit=5")).json()
    expect(rows[0]).toMatchObject({
      matchId: id,
      slug: "brave-amber-falcon",
      bestOf: 3,
      maps: ["aim_map", "aim_usp"],
      scoreFor: 2,
      scoreAgainst: 0,
      result: "win",
    })
    expect(rows[1]).toMatchObject({ matchId: single, slug: null, bestOf: null, maps: null, scoreFor: 13, scoreAgainst: 7 })
    const theirs = (await page(b!, "limit=5")).json().matches[0]
    expect(theirs).toMatchObject({ scoreFor: 0, scoreAgainst: 2, result: "loss" })
  })

  it("rejects bad cursors and gives the profile a first cursor", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    for (let i = 0; i < 21; i++) await played(a!, b!, { at: `2026-09-01 12:${String(i).padStart(2, "0")}:00+00` })
    expect((await page(a!, "cursor=nope")).statusCode).toBe(400)
    const forged = encodeCursor({ t: "2026-09-01 12:00:00+00", id: "not-a-uuid" as never })
    expect((await page(a!, `cursor=${forged}`)).statusCode).toBe(400)

    const profile = (await h.app.inject({ method: "GET", url: `/users/${a}/profile` })).json()
    expect(profile.recentMatches).toHaveLength(20)
    expect(profile.recentMatchesCursor).toEqual(expect.any(String))
    const rest = (await page(a!, `cursor=${profile.recentMatchesCursor}`)).json()
    expect(rest.matches).toHaveLength(1)
    expect(rest.nextCursor).toBeNull()
    const [oldest] = await h.db.select({ id: matches.id }).from(matches).where(eq(matches.createdAt, new Date("2026-09-01T12:00:00Z")))
    expect(rest.matches[0].matchId).toBe(oldest!.id)
    expect(decodeCursor(profile.recentMatchesCursor).t).toMatch(/^2026-09-01 12:01:00/)
  })
})
