import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  bans,
  cooldowns,
  flags,
  matchPlayers,
  matches,
  ratings,
  reports,
  trustLevels,
  trustSignals,
  users,
} from "../../db/schema.js"
import { DrizzleAdminStore } from "./store.js"

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url))
const NOW = new Date("2026-09-23T12:00:00Z")
const A = "76561198000000011"
const B = "76561198000000012"
const M1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const M2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

let pg: PGlite
let store: DrizzleAdminStore

beforeAll(async () => {
  pg = new PGlite()
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sqlText = readFileSync(join(MIGRATIONS, file), "utf8")
    for (const stmt of sqlText.split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt)
    }
  }
  const db = drizzle(pg)
  store = new DrizzleAdminStore(db)

  const hourAgo = new Date(NOW.getTime() - 3600_000)
  await db.insert(users).values([
    { steamId: A, displayName: "vexa", createdAt: hourAgo },
    { steamId: B, displayName: "kolt", createdAt: new Date("2025-01-01T00:00:00Z") },
  ])
  await db.insert(trustLevels).values({ steamId: A, level: "verified", reason: "clean checks" })
  await db.insert(trustSignals).values({ steamId: A, source: "steam_bans", clean: true, data: { vac: 0 } })
  await db.insert(ratings).values({ steamId: A, mode: "aim1v1", rating: 1612, rd: 80, volatility: 0.06, matchesPlayed: 12, wins: 8, losses: 4 })
  const teams = [
    { name: "team_a", steamIds: [A] },
    { name: "team_b", steamIds: [B] },
  ]
  await db.insert(matches).values([
    { id: M1, mode: "aim1v1", status: "finished", teams, webhookSecret: "s", endedAt: hourAgo, createdAt: new Date(NOW.getTime() - 7200_000), score: { team_a: 16, team_b: 10 }, winnerTeam: "team_a" },
    { id: M2, mode: "aim1v1", status: "live", teams, webhookSecret: "s", serverIp: "203.0.113.5", serverPort: 27016, connect: "connect x", createdAt: hourAgo },
  ])
  await db.insert(matchPlayers).values([
    { matchId: M1, steamId: A, team: 0, won: true, kills: 16, deaths: 10, headshots: 7 },
    { matchId: M1, steamId: B, team: 1, won: false, kills: 10, deaths: 16 },
  ])
  await db.insert(bans).values([
    { steamId: B, reason: "old", revokedAt: hourAgo },
    { steamId: B, reason: "toxic", expiresAt: new Date(NOW.getTime() + 86400_000) },
  ])
  await db.insert(reports).values({ reporterSteamId: B, reportedSteamId: A, reason: "aim" })
  await db.insert(flags).values({ steamId: A, source: "report" })
  await db.insert(cooldowns).values({ steamId: A, reason: "decline", offence: 1, endsAt: new Date(NOW.getTime() + 600_000) })
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe("DrizzleAdminStore", () => {
  it("pings and counts", async () => {
    await store.ping()
    expect(await store.counts(NOW)).toEqual({
      usersTotal: 2,
      usersNew24h: 1,
      matchesFinished24h: 1,
      matchesAbandoned24h: 0,
      activeBans: 1,
      openReports: 1,
      openFlags: 1,
    })
  })

  it("lists and loads matches with names", async () => {
    const recent = await store.listMatches(["finished"], 10)
    expect(recent.map((m) => m.id)).toEqual([M1])
    expect(recent[0]!.teams[0]!.players[0]).toEqual({ steamId: A, displayName: "vexa", avatarUrl: null })
    const live = await store.getMatch(M2)
    expect(live!.server).toEqual({ ip: "203.0.113.5", port: 27016, connect: "connect x" })
    const done = await store.getMatch(M1)
    expect(done!.players).toHaveLength(2)
    expect(await store.getMatch("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toBeNull()
  })

  it("loads a user with trust, ratings, matches, bans and moderation counts", async () => {
    const a = await store.getUser(A, NOW)
    expect(a!.trust).toMatchObject({ level: "verified", locked: false })
    expect(a!.trustSignals[0]).toMatchObject({ source: "steam_bans", clean: true, data: { vac: 0 } })
    expect(a!.ratings[0]).toMatchObject({ mode: "aim1v1", rating: 1612, wins: 8 })
    expect(a!.recentMatches[0]).toMatchObject({ id: M1, won: true, kills: 16, headshots: 7 })
    expect(a!.reports).toEqual({ received: 1, open: 1 })
    expect(a!.flags).toEqual({ total: 1, open: 1 })
    expect(a!.cooldowns).toHaveLength(1)
    expect(a!.activeBan).toBeNull()

    const b = await store.getUser(B, NOW)
    expect(b!.bans).toHaveLength(2)
    expect(b!.activeBan).toMatchObject({ reason: "toxic", active: true })
    expect(await store.getUser("76561198000000099", NOW)).toBeNull()
    expect(await store.userExists(A)).toBe(true)
  })

  it("writes and lists audit rows", async () => {
    const row = await store.writeAudit({ adminSteamId: A, action: "user.ban", target: B, payload: { reason: "x" } })
    expect(row).toMatchObject({ adminSteamId: A, action: "user.ban", target: B, payload: { reason: "x" } })
    await store.writeAudit({ adminSteamId: A, action: "match.cancel", target: M2, payload: { reason: "y" } })
    expect((await store.listAudit({ target: B, limit: 10 })).map((r) => r.action)).toEqual(["user.ban"])
    expect(await store.listAudit({ limit: 10 })).toHaveLength(2)
  })

  it("searches users by name or SteamID64 prefix with exact names first", async () => {
    await pg.exec(`insert into users (steam_id, display_name) values ('76561198000000013', 'vexa_alt')`)
    expect((await store.searchUsers("vexa", 10, NOW)).map((u) => u.displayName)).toEqual(["vexa", "vexa_alt"])
    // Short queries match the start of the name only
    expect((await store.searchUsers("ex", 10, NOW)).map((u) => u.displayName)).toEqual([])
    const [kolt] = await store.searchUsers("KOL", 10, NOW)
    expect(kolt).toMatchObject({ steamId: B, displayName: "kolt", banned: true, trustLevel: null })
    const [vexa] = await store.searchUsers("vexa", 10, NOW)
    expect(vexa).toMatchObject({ steamId: A, banned: false, trustLevel: "verified" })
    expect((await store.searchUsers("7656119800000001", 10, NOW)).map((u) => u.steamId).sort()).toEqual([A, B, "76561198000000013"])
    expect((await store.searchUsers(B, 10, NOW)).map((u) => u.steamId)).toEqual([B])
    expect(await store.searchUsers("%", 10, NOW)).toEqual([])
    expect(await store.searchUsers("vexa", 1, NOW)).toHaveLength(1)
  })

  it("finds the player's active match", async () => {
    expect(await store.activeMatchOf(A, ["live"])).toBeNull()
    await pg.exec(`insert into match_players (match_id, steam_id, team) values ('${M2}', '${A}', 0)`)
    expect(await store.activeMatchOf(A, ["live", "ready"])).toMatchObject({ id: M2, mode: "aim1v1", status: "live", slug: null })
    expect(await store.activeMatchOf(A, ["ready"])).toBeNull()
    expect(await store.activeMatchOf(B, ["live"])).toBeNull()
  })

  it("clears running cooldowns and keeps the rows", async () => {
    const cleared = await store.clearCooldowns(A, NOW)
    expect(cleared).toEqual([{ reason: "decline", offence: 1, endsAt: new Date(NOW.getTime() + 600_000).toISOString() }])
    expect((await store.getUser(A, NOW))!.cooldowns).toEqual([])
    expect(await store.clearCooldowns(A, NOW)).toEqual([])
    const rows = await pg.query<{ n: number }>(`select count(*)::int as n from cooldowns where steam_id = '${A}'`)
    expect(rows.rows[0]!.n).toBe(1)
  })
})
