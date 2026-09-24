import { PGlite } from "@electric-sql/pglite"
import { ServerMessageSchema, TeamNameSchema } from "@rushsite/shared"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { MIGRATIONS_DIR } from "../../db/client.js"
import { type CupDefinition, DEFAULT_CUPS, cupToSchedule } from "./config.js"
import tournamentsPlugin from "./index.js"
import { MemoryTournamentStore } from "./memory-store.js"
import { TournamentService } from "./service.js"
import { DrizzleTournamentStore } from "./store.js"
import type {
  Db,
  MatchResult,
  MatchResultHandler,
  PartyInfo,
  StartMatchParams,
  TournamentUpdatePayload,
  TrustLevel,
  WsMessage,
} from "./types.js"

const T0 = new Date("2026-09-23T12:00:00Z")
const ADMIN = "76561198000000001"
const cup = (key: string) => DEFAULT_CUPS.find((c) => c.key === key) as CupDefinition
const silentLog = { info() {}, warn() {}, error() {} }

async function harness(cups?: CupDefinition[]) {
  const store = new MemoryTournamentStore()
  const clock = { now: T0 }
  const started: (StartMatchParams & { matchId: string })[] = []
  const cancelled: string[] = []
  const emitted: WsMessage<TournamentUpdatePayload>[] = []
  const trust: Record<string, TrustLevel> = {}
  const parties: PartyInfo[] = []
  let handler: MatchResultHandler | undefined
  let service: TournamentService | undefined
  let seq = 0

  const app: FastifyInstance = Fastify()
  await app.register(tournamentsPlugin, {
    db: undefined as never,
    store,
    onService: (s) => {
      service = s
    },
    ...(cups ? { cups } : {}),
    scheduler: false,
    now: () => clock.now,
    startMatch: async (p) => {
      const matchId = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`
      started.push({ ...p, matchId })
      return { matchId }
    },
    onMatchResult: (h) => {
      handler = h
    },
    emit: (m) => {
      emitted.push(m)
    },
    authenticate: async (req) => (req.headers["x-steam-id"] as string | undefined) ?? null,
    isAdmin: (id) => id === ADMIN,
    cancelMatch: async (id) => {
      cancelled.push(id)
    },
    getTrustLevels: async (ids) => Object.fromEntries(ids.map((id) => [id, trust[id] ?? "verified"])),
    getRatings: async () => ({}),
    getProfiles: async (ids) => Object.fromEntries(ids.map((id) => [id, { displayName: `N-${id}`, avatarUrl: null }])),
    getParty: async (id) => parties.find((p) => p.memberSteamIds.includes(id)) ?? null,
  })
  await app.ready()

  const svc = () => service as TournamentService
  return {
    app,
    store,
    clock,
    started,
    cancelled,
    emitted,
    trust,
    parties,
    tick: () => svc().tick(),
    result: (r: MatchResult) => (handler as MatchResultHandler)(r),
    enter: (id: string, steamId: string, body?: unknown) =>
      app.inject({ method: "POST", url: `/tournaments/${id}/enter`, headers: { "x-steam-id": steamId }, payload: body as object }),
    admin: (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, as = ADMIN) =>
      app.inject({ method, url, headers: { "x-steam-id": as }, ...(body === undefined ? {} : { payload: body as object }) }),
    tournaments: () => [...store.tournaments.values()],
    only: () => {
      const all = [...store.tournaments.values()]
      if (all.length !== 1) throw new Error(`expected one tournament, got ${all.length}`)
      return all[0]!
    },
    startNow: async (startsAt: Date) => {
      clock.now = new Date(startsAt.getTime() + 1000)
      await svc().startDue()
    },
  }
}

type H = Awaited<ReturnType<typeof harness>>
let h: H | undefined

afterEach(async () => {
  for (const m of h?.emitted ?? []) ServerMessageSchema.parse(m)
  await h?.app.close()
  h = undefined
})

function bracketOf(store: MemoryTournamentStore, id: string) {
  const b = store.brackets.get(id)?.bracket
  if (!b) throw new Error("no bracket")
  return b
}

// Four solo entrants in a running daily 1v1 cup. Round one has two live games.
async function runningFour() {
  const x = await harness([cup("daily-aim1v1")])
  h = x
  await x.tick()
  const t = x.only()
  for (const p of ["p1", "p2", "p3", "p4"]) expect((await x.enter(t.id, p)).statusCode).toBe(201)
  await x.startNow(t.startsAt)
  expect(x.only().status).toBe("running")
  const entryOf = (steamId: string) => [...x.store.entries.values()].find((e) => e.steamIds.includes(steamId))!.id
  return { x, t, entryOf }
}

describe("scheduler reads cup_schedules", () => {
  it("reopens the cup it cancelled when a schedule is turned off and on before the slot", async () => {
    const x = await harness([cup("daily-aim1v1")])
    h = x
    await x.tick()
    const t = x.only()
    const [schedule] = (await x.admin("GET", "/admin/tournaments/schedules")).json().schedules
    await x.admin("PATCH", `/admin/tournaments/schedules/${schedule.id}`, { enabled: false })
    expect(x.only()).toMatchObject({ status: "cancelled", cancelReason: "schedule_disabled" })

    await x.admin("PATCH", `/admin/tournaments/schedules/${schedule.id}`, { enabled: true })
    await x.tick()
    expect(x.only()).toMatchObject({ id: t.id, status: "open", cancelReason: null, completedAt: null })
    expect(x.only().startsAt).toEqual(t.startsAt)
  })

  it("moves on to the next slot when an admin cancelled the upcoming cup", async () => {
    const x = await harness([cup("daily-aim1v1")])
    h = x
    await x.tick()
    const t = x.only()
    expect((await x.admin("POST", `/admin/tournaments/${t.id}/cancel`, { reason: "Not enough servers tonight" })).statusCode).toBe(200)
    await x.tick()
    const open = x.tournaments().filter((c) => c.status === "open")
    expect(open).toHaveLength(1)
    expect(open[0]!.startsAt.getTime() - t.startsAt.getTime()).toBe(24 * 3600_000)
  })

  it("creates cups only for enabled schedule rows", async () => {
    const x = await harness()
    h = x
    await x.tick()
    expect(x.tournaments()).toHaveLength(0)

    const created = await x.admin("POST", "/admin/tournaments/schedules", {
      mode: "rush3v3",
      cadence: "weekly",
      weekday: 3,
      startTime: "20:30",
      maxEntrants: 8,
      minTrust: "trusted",
    })
    expect(created.statusCode).toBe(201)
    const schedule = created.json().schedule
    expect(schedule).toMatchObject({ name: "Weekly 3v3 Rush Cup", enabled: true, bestOfFinal: 3 })
    expect(schedule.nextStartsAt).toBe("2026-09-23T20:30:00.000Z")
    const t = x.only()
    expect(t).toMatchObject({ cupKey: schedule.cupKey, mode: "rush3v3", maxEntrants: 8, minTrust: "trusted" })
    expect(t.startsAt.toISOString()).toBe("2026-09-23T20:30:00.000Z")

    // One open cup per schedule at a time
    await x.tick()
    expect(x.tournaments()).toHaveLength(1)

    // Moving the time moves the open cup
    const moved = await x.admin("PATCH", `/admin/tournaments/schedules/${schedule.id}`, { startTime: "21:00", maxEntrants: 16 })
    expect(moved.statusCode).toBe(200)
    expect(x.only().startsAt.toISOString()).toBe("2026-09-23T21:00:00.000Z")
    expect(x.only().maxEntrants).toBe(16)

    // Disabling cancels the open cup when nobody entered
    const off = await x.admin("PATCH", `/admin/tournaments/schedules/${schedule.id}`, { enabled: false })
    expect(off.json().openCup).toMatchObject({ tournamentId: t.id, action: "cancelled", entrantCount: 0 })
    expect(x.only()).toMatchObject({ status: "cancelled", cancelReason: "schedule_disabled" })
    x.clock.now = new Date("2026-09-23T21:00:01Z")
    await x.tick()
    expect(x.tournaments()).toHaveLength(1)
    await x.admin("PATCH", `/admin/tournaments/schedules/${schedule.id}`, { enabled: true })
    expect(x.tournaments()).toHaveLength(2)

    const list = await x.admin("GET", "/admin/tournaments/schedules")
    expect(list.json().schedules).toHaveLength(1)
    // Deleting keeps an open cup that has entries and says so
    const next = x.tournaments().find((c) => c.status === "open")!
    x.parties.push({ partyId: "r", leaderSteamId: "r1", memberSteamIds: ["r1", "r2", "r3"] })
    x.trust.r1 = x.trust.r2 = x.trust.r3 = "trusted"
    expect((await x.enter(next.id, "r1")).statusCode).toBe(201)
    const del = await x.admin("DELETE", `/admin/tournaments/schedules/${schedule.id}`)
    expect(del.statusCode).toBe(200)
    expect(del.json().openCup).toMatchObject({ tournamentId: next.id, action: "kept", entrantCount: 1 })
    expect(x.store.tournaments.get(next.id)?.status).toBe("open")
    expect((await x.admin("GET", "/admin/tournaments/schedules")).json().schedules).toHaveLength(0)
    expect(x.store.audit.map((a) => a.action)).toEqual([
      "tournament.schedule_create",
      "tournament.schedule_update",
      "tournament.schedule_update",
      "tournament.schedule_update",
      "tournament.schedule_delete",
    ])
  })

  it("rejects bad schedules and hides admin routes from non-admins", async () => {
    const x = await harness()
    h = x
    const weeklyNoDay = await x.admin("POST", "/admin/tournaments/schedules", {
      mode: "aim1v1",
      cadence: "weekly",
      startTime: "18:00",
      maxEntrants: 8,
      minTrust: "verified",
    })
    expect(weeklyNoDay.statusCode).toBe(400)
    expect((await x.admin("GET", "/admin/tournaments/schedules", undefined, "76561198000000002")).statusCode).toBe(404)
    expect((await x.app.inject({ url: "/admin/tournaments/schedules" })).statusCode).toBe(404)
  })

  it("seeds the six default cups in the migration and the drizzle store drives the scheduler", async () => {
    const client = new PGlite()
    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR })
      const db = drizzle(client) as unknown as Db
      const store = new DrizzleTournamentStore(db)
      const rows = await store.listSchedules()
      const strip = ({ id: _i, updatedAt: _u, ...rest }: (typeof rows)[number]) => rest
      const sortKey = (a: { cupKey: string }, b: { cupKey: string }) => a.cupKey.localeCompare(b.cupKey)
      expect(rows.map(strip).sort(sortKey)).toEqual(DEFAULT_CUPS.map(cupToSchedule).sort(sortKey))

      const service = new TournamentService({
        store,
        now: () => T0,
        log: silentLog,
        startMatch: async () => ({ matchId: "x" }),
        emit: () => {},
        getTrustLevels: async () => ({}),
        getRatings: async () => ({}),
        getParty: async () => null,
        getProfiles: async () => ({}),
      })
      await service.tick()
      const open = await store.listTournaments({ status: ["open"] })
      expect(open).toHaveLength(6)
      expect(open.find((t) => t.cupKey === "weekly-rush3v3")?.startsAt.toISOString()).toBe("2026-09-27T17:00:00.000Z")

      const daily = rows.find((r) => r.cupKey === "daily-aim1v1")!
      await store.updateSchedule(daily.id, { enabled: false })
      await store.updateTournament(open.find((t) => t.cupKey === "daily-aim1v1")!.id, { status: "cancelled" })
      await service.tick()
      expect(await store.listTournaments({ status: ["open"] })).toHaveLength(5)

      // Preview takes the first five live entries per cup in one query
      const [c1, c2] = open.filter((t) => t.cupKey !== "daily-aim1v1") as [(typeof open)[number], (typeof open)[number]]
      const made: Awaited<ReturnType<typeof store.insertEntry>>[] = []
      for (let i = 0; i < 7; i++) {
        made.push(await store.insertEntry({ tournamentId: c1.id, captainSteamId: `7656119800000010${i}`, steamIds: [`7656119800000010${i}`], teamName: i === 0 ? "Night Owls" : null }))
      }
      await store.insertEntry({ tournamentId: c2.id, captainSteamId: "76561198000000200", steamIds: ["76561198000000200"] })
      await store.disqualifyEntry(made[1]!.id, "alt", T0)
      const preview = await store.previewEntries([c1.id, c2.id], 5)
      expect(preview.filter((e) => e.tournamentId === c1.id).map((e) => e.id)).toEqual([0, 2, 3, 4, 5].map((i) => made[i]!.id))
      expect(preview.filter((e) => e.tournamentId === c2.id)).toHaveLength(1)
      expect(preview[0]?.teamName).toBe("Night Owls")
      expect((await store.getEntries([made[6]!.id, "nope"])).map((e) => e.id)).toEqual([made[6]!.id])
    } finally {
      await client.close()
    }
  })
})

describe("list extras", () => {
  it("fills entrantPreview and winner on list and detail", async () => {
    const x = await harness([cup("daily-aim2v2")])
    h = x
    await x.tick()
    const t = x.only()
    const names = ["Alpha Squad", null, "Gamma Crew", null, "Epsilon", "Zeta"]
    for (let i = 0; i < names.length; i++) {
      x.parties.push({ partyId: `p${i}`, leaderSteamId: `c${i}`, memberSteamIds: [`c${i}`, `m${i}`] })
      const name = names[i]
      expect((await x.enter(t.id, `c${i}`, name ? { teamName: name } : undefined)).statusCode).toBe(201)
    }
    const row = (await x.app.inject({ url: "/tournaments" })).json().tournaments[0]
    expect(row.entrantPreview).toHaveLength(5)
    expect(row.entrantPreview.slice(0, 2)).toEqual([
      { steamId: "c0", displayName: "Alpha Squad", avatarUrl: null },
      { steamId: "c1", displayName: "N-c1", avatarUrl: null },
    ])
    expect(row.winner).toBeNull()

    // Finish the cup by forcing every series
    await x.startNow(t.startsAt)
    for (;;) {
      const open = bracketOf(x.store, t.id).matches.find((m) => ["ready", "provisioning", "live"].includes(m.status))
      if (!open) break
      await x.admin("POST", `/admin/tournaments/${t.id}/matches/${open.id}/force-result`, { winnerEntryId: open.a, reason: "r" })
    }
    const done = x.only()
    expect(done.status).toBe("completed")
    const champ = x.store.entries.get(done.winnerEntryId!)!
    const expected = { entryId: champ.id, name: champ.teamName ?? `N-${champ.captainSteamId}`, avatarUrl: null }
    const listed = (await x.app.inject({ url: "/tournaments?status=completed" })).json().tournaments[0]
    expect(listed.winner).toEqual(expected)
    const detail = (await x.app.inject({ url: `/tournaments/${t.id}` })).json().tournament
    expect(detail.winner).toEqual(expected)
    expect(detail.entrantPreview).toHaveLength(5)
  })
})

describe("team names", () => {
  it("validates the shared schema", () => {
    expect(TeamNameSchema.parse("  The   Squad ")).toBe("The Squad")
    for (const bad of ["ab", "x".repeat(25), "  ", "-dash", "semi;colon", "<b>"]) {
      expect(TeamNameSchema.safeParse(bad).success).toBe(false)
    }
    expect(TeamNameSchema.safeParse("Ñandú #1").success).toBe(true)
  })

  it("stores team names on team entries and shows them as the entry name", async () => {
    const x = await harness([cup("daily-aim2v2"), cup("daily-aim1v1")])
    h = x
    await x.tick()
    const duo = x.tournaments().find((t) => t.mode === "aim2v2")!
    const solo = x.tournaments().find((t) => t.mode === "aim1v1")!
    x.parties.push({ partyId: "a", leaderSteamId: "a1", memberSteamIds: ["a1", "a2"] })
    x.parties.push({ partyId: "b", leaderSteamId: "b1", memberSteamIds: ["b1", "b2"] })
    x.parties.push({ partyId: "c", leaderSteamId: "c1", memberSteamIds: ["c1", "c2"] })

    const short = await x.enter(duo.id, "a1", { teamName: "ab" })
    expect(short.statusCode).toBe(400)
    expect(short.json().error).toBe("invalid_team_name")

    const ok = await x.enter(duo.id, "a1", { teamName: "  Night   Owls " })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().entry).toMatchObject({ name: "Night Owls", teamName: "Night Owls" })

    const dupe = await x.enter(duo.id, "b1", { teamName: "night owls" })
    expect(dupe.statusCode).toBe(409)
    expect(dupe.json().error).toBe("team_name_taken")

    // Team name is optional and falls back to the captain
    const plain = await x.enter(duo.id, "c1")
    expect(plain.json().entry).toMatchObject({ name: "N-c1", teamName: null })

    const soloName = await x.enter(solo.id, "s1", { teamName: "Lone Wolf" })
    expect(soloName.statusCode).toBe(400)
    expect(soloName.json().error).toBe("team_name_not_allowed")

    const detail = (await x.app.inject({ url: `/tournaments/${duo.id}` })).json().tournament
    expect(detail.entries.map((e: { name: string }) => e.name)).toEqual(["Night Owls", "N-c1"])
  })
})

describe("admin cup tools", () => {
  it("disqualifying a player in a live game advances the opponent", async () => {
    const { x, t, entryOf } = await runningFour()
    const b0 = bracketOf(x.store, t.id)
    const m = b0.matches.find((mm) => mm.round === 1 && mm.status === "live")!
    const loser = m.a!
    const winner = m.b!
    const liveId = m.liveMatchId!

    const res = await x.admin("POST", `/admin/tournaments/${t.id}/entries/${loser}/disqualify`, { reason: "cheating" })
    expect(res.statusCode).toBe(200)
    const b1 = bracketOf(x.store, t.id)
    const done = b1.matches.find((mm) => mm.id === m.id)!
    expect(done).toMatchObject({ status: "done", winner, resolution: "disqualified", liveMatchId: null })
    const next = b1.matches.find((mm) => mm.round === 2)!
    expect(m.index % 2 === 0 ? next.a : next.b).toBe(winner)
    expect(x.cancelled).toEqual([liveId])
    expect(x.store.entries.get(loser)?.disqualifyReason).toBe("cheating")
    expect(x.store.audit.at(-1)).toMatchObject({
      adminSteamId: ADMIN,
      action: "tournament.disqualify",
      target: t.id,
      payload: { entryId: loser, reason: "cheating" },
    })

    // The late result of the cancelled game changes nothing
    await x.result({ matchId: liveId, outcome: "completed", winnerTeam: "A", score: {} })
    expect(bracketOf(x.store, t.id).matches.find((mm) => mm.id === m.id)?.winner).toBe(winner)

    const again = await x.admin("POST", `/admin/tournaments/${t.id}/entries/${loser}/disqualify`, { reason: "x" })
    expect(again.json().error).toBe("already_disqualified")
    expect(entryOf("p1")).toBeTruthy()
  })

  it("disqualifying an entry still waiting on its next opponent settles when that series is ready", async () => {
    const { x, t } = await runningFour()
    const r1 = bracketOf(x.store, t.id).matches.filter((mm) => mm.round === 1)
    const [first, second] = r1 as [(typeof r1)[number], (typeof r1)[number]]
    // first series finishes, its winner waits in the final
    await x.result({ matchId: first.liveMatchId!, outcome: "completed", winnerTeam: "A", score: {} })
    const waiting = first.a!
    await x.admin("POST", `/admin/tournaments/${t.id}/entries/${waiting}/disqualify`, { reason: "smurf" })
    // second series ends, the final resolves without being played and the cup completes
    await x.result({ matchId: second.liveMatchId!, outcome: "completed", winnerTeam: "B", score: {} })
    const final = bracketOf(x.store, t.id).matches.find((mm) => mm.round === 2)!
    expect(final).toMatchObject({ status: "done", winner: second.b, resolution: "disqualified" })
    expect(x.only()).toMatchObject({ status: "completed", winnerEntryId: second.b })
    expect(x.started.filter((s) => s.source.bracketMatchId === final.id)).toHaveLength(0)
  })

  it("disqualifying in an open cup blocks the players from entering again", async () => {
    const x = await harness([cup("daily-aim1v1")])
    h = x
    await x.tick()
    const t = x.only()
    const entry = (await x.enter(t.id, "p1")).json().entry
    await x.admin("POST", `/admin/tournaments/${t.id}/entries/${entry.id}/disqualify`, { reason: "alt account" })
    const detail = (await x.app.inject({ url: `/tournaments/${t.id}`, headers: { "x-steam-id": "p1" } })).json().tournament
    expect(detail.entrantCount).toBe(0)
    expect(detail.myEntryId).toBeNull()
    expect(detail.entries[0]).toMatchObject({ id: entry.id, disqualified: true })
    const back = await x.enter(t.id, "p1")
    expect(back.statusCode).toBe(403)
    expect(back.json().error).toBe("disqualified")
  })

  it("force-result advances the chosen winner and can finish the cup", async () => {
    const { x, t } = await runningFour()
    const r1 = bracketOf(x.store, t.id).matches.filter((mm) => mm.round === 1)
    const [first, second] = r1 as [(typeof r1)[number], (typeof r1)[number]]

    const outsider = await x.admin("POST", `/admin/tournaments/${t.id}/matches/${first.id}/force-result`, {
      winnerEntryId: second.a,
      reason: "dispute",
    })
    expect(outsider.statusCode).toBe(400)
    expect(outsider.json().error).toBe("not_in_match")

    const res = await x.admin("POST", `/admin/tournaments/${t.id}/matches/${first.id}/force-result`, {
      winnerEntryId: first.b,
      reason: "server crash, B was up 12-3",
    })
    expect(res.statusCode).toBe(200)
    expect(x.cancelled).toEqual([first.liveMatchId])
    let b = bracketOf(x.store, t.id)
    expect(b.matches.find((mm) => mm.id === first.id)).toMatchObject({ status: "done", winner: first.b, resolution: "admin_decision" })
    expect(b.matches.find((mm) => mm.round === 2)?.a).toBe(first.b)

    const twice = await x.admin("POST", `/admin/tournaments/${t.id}/matches/${first.id}/force-result`, {
      winnerEntryId: first.b,
      reason: "again",
    })
    expect(twice.json().error).toBe("match_not_open")

    await x.admin("POST", `/admin/tournaments/${t.id}/matches/${second.id}/force-result`, { winnerEntryId: second.a, reason: "r" })
    b = bracketOf(x.store, t.id)
    const final = b.matches.find((mm) => mm.round === 2)!
    expect(final.status).toBe("live")
    await x.admin("POST", `/admin/tournaments/${t.id}/matches/${final.id}/force-result`, { winnerEntryId: second.a, reason: "r" })
    expect(x.only()).toMatchObject({ status: "completed", winnerEntryId: second.a })
    // The admin decided loser still places as runner-up
    expect(x.store.badges.filter((bd) => bd.kind === "cup_runner_up").map((bd) => bd.steamId)).toHaveLength(1)
    expect(x.store.audit.filter((a) => a.action === "tournament.force_result")).toHaveLength(3)

    // Stripping removes the champion's badge and is audited
    const champ = x.store.entries.get(second.a!)!
    const strip = await x.admin("POST", `/admin/tournaments/${t.id}/entries/${champ.id}/strip-badges`, { reason: "cheat confirmed" })
    expect(strip.statusCode).toBe(200)
    expect(strip.json().removed).toBe(1)
    expect(x.store.badges.some((bd) => champ.steamIds.includes(bd.steamId))).toBe(false)
    expect(x.store.audit.at(-1)).toMatchObject({ action: "tournament.strip_badges", payload: { entryId: champ.id, removed: 1 } })
    const again = await x.admin("POST", `/admin/tournaments/${t.id}/entries/${champ.id}/strip-badges`, { reason: "x" })
    expect(again.json().error).toBe("no_badges")
  })

  it("strip-badges needs a completed cup", async () => {
    const { x, t, entryOf } = await runningFour()
    const res = await x.admin("POST", `/admin/tournaments/${t.id}/entries/${entryOf("p1")}/strip-badges`, { reason: "r" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe("not_completed")
  })

  it("passes team names to the match as display names", async () => {
    const x = await harness([cup("daily-aim2v2")])
    h = x
    await x.tick()
    const t = x.only()
    x.parties.push({ partyId: "a", leaderSteamId: "a1", memberSteamIds: ["a1", "a2"] })
    x.parties.push({ partyId: "b", leaderSteamId: "b1", memberSteamIds: ["b1", "b2"] })
    await x.enter(t.id, "a1", { teamName: "Night Owls" })
    await x.enter(t.id, "b1")
    await x.startNow(t.startsAt)
    const teams = x.started[0]!.teams
    const owls = teams.find((tm) => tm.steamIds.includes("a1"))!
    const other = teams.find((tm) => tm.steamIds.includes("b1"))!
    expect(owls).toMatchObject({ displayName: "Night Owls" })
    expect(["A", "B"]).toContain(owls.name)
    expect(other).not.toHaveProperty("displayName")
  })

  it("creates, reschedules and cancels one-off cups", async () => {
    const x = await harness()
    h = x
    const bad = await x.admin("POST", "/admin/tournaments", {
      mode: "aim1v1",
      name: "Past Cup",
      startsAt: "2026-09-23T11:00:00Z",
      maxEntrants: 8,
      minTrust: "new",
    })
    expect(bad.statusCode).toBe(400)
    const res = await x.admin("POST", "/admin/tournaments", {
      mode: "aim2v2",
      name: "Launch Cup",
      startsAt: "2026-09-25T19:00:00Z",
      maxEntrants: 8,
      minTrust: "new",
    })
    expect(res.statusCode).toBe(201)
    const cupRow = res.json().tournament
    expect(cupRow).toMatchObject({ name: "Launch Cup", cadence: "special", status: "open", maxEntrants: 8, minTrust: "new" })
    // Sign-ups open straight away
    x.parties.push({ partyId: "a", leaderSteamId: "a1", memberSteamIds: ["a1", "a2"] })
    expect((await x.enter(cupRow.id, "a1", { teamName: "Early Birds" })).statusCode).toBe(201)

    const moved = await x.admin("POST", `/admin/tournaments/${cupRow.id}/reschedule`, { startsAt: "2026-09-26T19:00:00Z" })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().tournament.startsAt).toBe("2026-09-26T19:00:00.000Z")
    expect(x.emitted.at(-1)?.payload.kind).toBe("rescheduled")

    const cancel = await x.admin("POST", `/admin/tournaments/${cupRow.id}/cancel`, { reason: "no casters" })
    expect(cancel.statusCode).toBe(200)
    expect(x.only()).toMatchObject({ status: "cancelled", cancelReason: "admin_cancelled" })
    expect((await x.admin("POST", `/admin/tournaments/${cupRow.id}/reschedule`, { startsAt: "2026-09-27T19:00:00Z" })).json().error).toBe(
      "already_started",
    )
    expect(x.store.audit.map((a) => a.action)).toEqual(["tournament.create", "tournament.reschedule", "tournament.cancel"])
  })

  it("cancelling a running cup stops its live games", async () => {
    const { x, t } = await runningFour()
    const live = bracketOf(x.store, t.id).matches.filter((mm) => mm.status === "live").map((mm) => mm.liveMatchId)
    const res = await x.admin("POST", `/admin/tournaments/${t.id}/cancel`, { reason: "server outage" })
    expect(res.statusCode).toBe(200)
    expect(x.cancelled.sort()).toEqual(live.sort())
    expect(x.only().status).toBe("cancelled")
  })
})
