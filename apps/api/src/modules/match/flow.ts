import { randomUUID } from "node:crypto"
import {
  ACTIVE_MATCH_STATUSES,
  ACCEPT_WINDOW_SEC,
  DRAW_WINNER,
  VETO_STEP_SEC,
  VetoError,
  createVeto,
  findMap,
  getModeConfig,
  resolveStep,
  unresolvedConfig,
  vote as castVetoVote,
  type MatchCancelledPayload,
  type MatchRound as MatchRoundView,
  type MatchStatus,
  type MatchUpdatePayload,
  type MatchEvent,
  type MatchFoundPayload,
  type MatchResultPayload,
  type Mode,
  type RatingChange,
  type ServerReadyPayload,
  type VetoFormat,
  type VetoState,
  type VetoStatePayload,
} from "@rushsite/shared"
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { cooldowns, demos, matchMaps, matchPlayers, matchRounds, matches, vetoes, type TeamRosterJson } from "../../db/schema.js"
import type { Rng } from "../../lib/clock.js"
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js"
import type { EventLog } from "../../lib/event-log.js"
import { randomPassword, randomToken } from "../../lib/hmac.js"
import { withLease, withLock } from "../../lib/redis.js"
import type { CooldownService } from "../queue/cooldowns.js"
import type { LiveTicket, QueueService } from "../queue/service.js"
import type { RatingService } from "../rating/service.js"
import type { TrustService } from "../trust/service.js"
import { toUsers, type Notifier } from "../ws/hub.js"
import { resolveAbandon, resolveAccept, type AcceptOutcome } from "./accept.js"
import type { Allocator } from "./allocator.js"
import { roundView, teamScores } from "./match-page.js"
import { storeKill } from "./extras.js"
import { newMatchSlug } from "./slug.js"
import { demoKey } from "./storage.js"
import {
  isSeries,
  loadMapRows,
  mapViews,
  mapWins,
  padMaps,
  seedPriorMaps,
  seriesParams,
  seriesWinner,
  sumStats,
  toStatsJson,
  type PriorMap,
} from "./series.js"
import { MATCH_TIMEOUT, isWatched, type MatchWatchdog, type WatchdogReason } from "./watchdog.js"
import { eachLimit } from "../../lib/async.js"

type MatchRow = typeof matches.$inferSelect
type PlayerRow = typeof matchPlayers.$inferSelect

// Series only. Every decided map, with the match it was played on
export type SeriesMapOutcome = { mapNumber: number; winnerTeam: string; matchId: string }

export type MatchResultEvent =
  | { matchId: string; outcome: "completed"; winnerTeam: string; score: Record<string, number>; maps?: SeriesMapOutcome[] }
  | { matchId: string; outcome: "abandoned"; reason: string; missingSteamIds: string[] }
  | { matchId: string; outcome: "cancelled"; reason: string }

export type ResultListener = (result: MatchResultEvent) => Promise<void>

// One map of a series is decided. The series result follows through the result listeners
export type MapResultEvent = { matchId: string; mapNumber: number; winnerTeam: string }
export type MapResultListener = (result: MapResultEvent) => Promise<void>

type TournamentTeam = { name: string; steamIds: string[]; displayName?: string }

export type TournamentMatchParams = {
  mode: Mode
  teams: [TournamentTeam, TournamentTeam]
  // gameNumber is the first map to play. Maps before it were decided on an earlier server and come in priorMaps
  source: {
    kind: "tournament"
    tournamentId: string
    bracketMatchId: string
    gameNumber: number
    bestOf: number
    priorMaps?: PriorMap[]
  }
}

export type FlowOptions = {
  allocationTimeoutSec: number
  connectTimeoutSec: number
  // Server teardown waits this long for demo_uploaded after the match ends
  demoWaitSec: number
  allowUnresolvedModes?: boolean
  // Per match allocation lock. It is renewed while a server boots, so this only matters after a crash
  allocationLeaseMs?: number
}

export type FlowDeps = {
  db: Db
  redis: Redis
  notifier: Notifier
  queue: QueueService
  cooldowns: CooldownService
  ratings: RatingService
  trust: TrustService
  allocator: Allocator
  log: FastifyBaseLogger
  events?: EventLog
  // Ends matches whose server is gone or that ran too long
  watchdog?: MatchWatchdog
  now?: () => number
  rng?: Rng
  options: FlowOptions
}

export const SERVER_CRASHED = "server_crashed"

// The next map of a series did not load. The server is at fault, so it ends like a crash
export const MAP_LOAD_FAILED = "map_load_failed"

const TERMINAL = new Set(["finished", "abandoned", "cancelled"])

// A started server can still be attached to a match in these statuses
const PRE_LIVE = new Set(["allocating", "starting", "ready"])

// Nobody could reach the server, so the failure is ours
export const SERVER_UNREACHABLE = "server_unreachable"

export const ALLOCATION_CONCURRENCY = 4

// Match lifecycle from match found to result. Postgres rows are the state, row locks serialise changes
export class MatchFlow {
  private readonly listeners: ResultListener[] = []
  private readonly mapListeners: MapResultListener[] = []
  private readonly playerHooks: ((steamIds: string[]) => Promise<void>)[] = []
  private readonly matchHooks: ((m: MatchRow) => Promise<void>)[] = []
  private readonly now: () => number
  private readonly rng: Rng
  private lastCooldownSweep: number | null = null
  private lastWatchdogRun: number | null = null

  constructor(private readonly d: FlowDeps) {
    this.now = d.now ?? Date.now
    this.rng = d.rng ?? Math.random
  }

  onResult(listener: ResultListener): void {
    this.listeners.push(listener)
  }

  onMapResult(listener: MapResultListener): void {
    this.mapListeners.push(listener)
  }

  private async emitMapResult(result: MapResultEvent): Promise<void> {
    for (const l of this.mapListeners) {
      try {
        await l(result)
      } catch (err) {
        this.d.log.error({ err, matchId: result.matchId }, "map result listener failed")
      }
    }
  }

  // Runs when players enter a match. Presence uses it
  onPlayersChanged(hook: (steamIds: string[]) => Promise<void>): void {
    this.playerHooks.push(hook)
  }

  private async playersChanged(steamIds: string[]): Promise<void> {
    for (const h of this.playerHooks) await h(steamIds).catch(() => undefined)
  }

  // Runs on server ready, match start and every round end with the fresh row
  onMatchChanged(hook: (m: MatchRow) => Promise<void>): void {
    this.matchHooks.push(hook)
  }

  private async matchChanged(m: MatchRow): Promise<void> {
    for (const h of this.matchHooks) await h(m).catch(() => undefined)
  }

  private async emitResult(result: MatchResultEvent): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l(result)
      } catch (err) {
        this.d.log.error({ err, matchId: result.matchId }, "match result listener failed")
      }
    }
  }

  private async lock(tx: Db, matchId: string): Promise<MatchRow | undefined> {
    const [m] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update")
    return m
  }

  private async players(tx: Db, matchId: string): Promise<PlayerRow[]> {
    return tx.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId)).orderBy(asc(matchPlayers.team))
  }

  private allSteamIds(m: MatchRow): string[] {
    return m.teams.flatMap((t) => t.steamIds)
  }

  private tx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.d.db.transaction((tx) => fn(tx as unknown as Db))
  }

  // Queue path. Consumes the tickets and opens the accept window
  async createFromQueue(
    mode: Mode,
    teams: [LiveTicket[], LiveTicket[]],
  ): Promise<{ ok: true; matchId: string } | { ok: false; lost: string[] }> {
    const matchId = randomUUID()
    const slug = await newMatchSlug(this.d.db)
    const tickets = [...teams[0], ...teams[1]]
    const claim = await this.d.queue.claim(
      tickets.map((t) => t.id),
      matchId,
      mode,
    )
    if (!claim.ok) return claim
    const rosters: TeamRosterJson[] = [
      { name: "A", steamIds: teams[0].flatMap((t) => t.steamIds) },
      { name: "B", steamIds: teams[1].flatMap((t) => t.steamIds) },
    ]
    const deadline = this.now() + ACCEPT_WINDOW_SEC * 1000
    await this.tx(async (tx) => {
      await tx.insert(matches).values({
        id: matchId,
        mode,
        status: "accepting",
        source: "queue",
        teams: rosters,
        acceptDeadline: new Date(deadline),
        slug,
        webhookSecret: randomToken(32),
        password: randomPassword(),
        createdAt: new Date(this.now()),
      })
      await tx.insert(matchPlayers).values(
        teams.flatMap((team, idx) =>
          team.flatMap((t) => t.steamIds.map((steamId) => ({ matchId, steamId, team: idx, partyId: t.partyId, ticketId: t.id }))),
        ),
      )
    })
    const total = rosters.reduce((s, r) => s + r.steamIds.length, 0)
    this.sendMatchFound(rosters.flatMap((r) => r.steamIds), { matchId, slug, mode, acceptDeadline: deadline, accepted: 0, required: total })
    this.d.events?.emit("match", { event: "match_found", matchId, mode, teams: rosters })
    await this.playersChanged(rosters.flatMap((r) => r.steamIds))
    return { ok: true, matchId }
  }

  private sendMatchFound(
    steamIds: string[],
    p: { matchId: string; slug?: string | null; mode: Mode; acceptDeadline: number; accepted: number; required: number },
  ): void {
    const { slug, ...rest } = p
    const payload: MatchFoundPayload = { ...rest, ...(slug ? { slug } : {}), acceptWindowSec: ACCEPT_WINDOW_SEC }
    toUsers(this.d.notifier, steamIds, "match_found", payload)
  }

  // Tournament path. Skips queue and accept. Throws when no server slot is free so the caller retries
  async createTournamentMatch(params: TournamentMatchParams): Promise<{ matchId: string }> {
    const matchId = randomUUID()
    const slug = await newMatchSlug(this.d.db)
    if (!this.d.options.allowUnresolvedModes && unresolvedConfig(params.mode).length > 0) {
      throw new Error(`mode ${params.mode} is not configured yet`)
    }
    // Hetzner first. With surge capacity configured the allocation step can fall back to it
    const reservation = await this.d.allocator.reserve(matchId)
    if (!reservation && !this.d.allocator.driver("dathost")) throw new Error("no_server_slot")
    let next: PostAccept
    try {
      next = await this.tx(async (tx) => {
        const [m] = await tx
          .insert(matches)
          .values({
            id: matchId,
            mode: params.mode,
            status: "allocating",
            source: "tournament",
            teams: params.teams.map((t) => ({
              name: t.name,
              steamIds: [...t.steamIds],
              ...(t.displayName ? { displayName: t.displayName } : {}),
            })),
            tournamentId: params.source.tournamentId,
            bracketMatchKey: params.source.bracketMatchId,
            gameNumber: params.source.gameNumber,
            bestOf: params.source.bestOf,
            hostId: reservation?.hostId ?? null,
            slotId: reservation?.slotId ?? null,
            gsltId: reservation?.gsltId ?? null,
            slug,
        webhookSecret: randomToken(32),
            password: randomPassword(),
            createdAt: new Date(this.now()),
          })
          .returning()
        await tx.insert(matchPlayers).values(
          params.teams.flatMap((t, idx) => t.steamIds.map((steamId) => ({ matchId, steamId, team: idx, accepted: true }))),
        )
        const post = await this.enterPostAccept(tx, m!)
        await this.carryPriorMaps(tx, m!, params.source.priorMaps ?? [])
        return post
      })
    } catch (err) {
      await this.d.allocator.release(matchId, "hetzner", false)
      throw err
    }
    await this.afterPostAccept(matchId, next)
    await this.playersChanged(params.teams.flatMap((t) => t.steamIds))
    return { matchId }
  }

  // Challenge path. Skips queue and accept, then runs the usual veto and allocation
  async createDirectMatch(params: {
    mode: Mode
    teams: [{ name: string; steamIds: string[] }, { name: string; steamIds: string[] }]
  }): Promise<{ matchId: string }> {
    const matchId = randomUUID()
    const slug = await newMatchSlug(this.d.db)
    if (!this.d.options.allowUnresolvedModes && unresolvedConfig(params.mode).length > 0) {
      throw new Error(`mode ${params.mode} is not configured yet`)
    }
    const rosters: TeamRosterJson[] = params.teams.map((t) => ({ name: t.name, steamIds: [...t.steamIds] }))
    const next = await this.tx(async (tx) => {
      const [m] = await tx
        .insert(matches)
        .values({
          id: matchId,
          mode: params.mode,
          status: "allocating",
          source: "challenge",
          teams: rosters,
          slug,
        webhookSecret: randomToken(32),
          password: randomPassword(),
          createdAt: new Date(this.now()),
        })
        .returning()
      await tx.insert(matchPlayers).values(
        rosters.flatMap((t, idx) => t.steamIds.map((steamId) => ({ matchId, steamId, team: idx, accepted: true }))),
      )
      return this.enterPostAccept(tx, m!)
    })
    this.d.events?.emit("match", { event: "match_found", matchId, mode: params.mode, teams: rosters, source: "challenge" })
    await this.afterPostAccept(matchId, next)
    await this.playersChanged(rosters.flatMap((r) => r.steamIds))
    return { matchId }
  }

  // accept_match from a player. accept false declines
  async respond(steamId: string, matchId: string, accept: boolean): Promise<void> {
    const result = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m) throw notFound("match_not_found")
      const players = await this.players(tx, matchId)
      const me = players.find((p) => p.steamId === steamId)
      if (!me) throw forbidden("not_in_match")
      if (m.status !== "accepting") throw conflict("not_accepting")
      const timedOut = !!m.acceptDeadline && this.now() > m.acceptDeadline.getTime()
      if (!timedOut) {
        await tx
          .update(matchPlayers)
          .set(accept ? { accepted: true } : { declined: true })
          .where(and(eq(matchPlayers.matchId, matchId), eq(matchPlayers.steamId, steamId)))
        if (accept) me.accepted = true
        else me.declined = true
      }
      const outcome = resolveAccept(players, timedOut)
      const post = await this.applyAcceptOutcome(tx, m, outcome)
      return { m, outcome, post }
    })
    await this.afterAccept(result.m, result.outcome, result.post)
  }

  private async applyAcceptOutcome(tx: Db, m: MatchRow, outcome: AcceptOutcome): Promise<PostAccept | null> {
    if (outcome.kind === "all_accepted") return this.enterPostAccept(tx, m)
    if (outcome.kind === "failed") {
      await tx
        .update(matches)
        .set({ status: "cancelled", cancelReason: `accept_${outcome.reason}`, endedAt: new Date(this.now()) })
        .where(eq(matches.id, m.id))
    }
    return null
  }

  private async afterAccept(m: MatchRow, outcome: AcceptOutcome, post: PostAccept | null, allocateNow = true): Promise<void> {
    const everyone = this.allSteamIds(m)
    const deadline = m.acceptDeadline?.getTime() ?? this.now()
    if (outcome.kind === "pending") {
      this.sendMatchFound(everyone, { matchId: m.id, slug: m.slug, mode: m.mode, acceptDeadline: deadline, ...outcome })
      return
    }
    if (outcome.kind === "all_accepted") {
      this.sendMatchFound(everyone, {
        matchId: m.id,
        slug: m.slug,
        mode: m.mode,
        acceptDeadline: deadline,
        accepted: everyone.length,
        required: everyone.length,
      })
      if (post) await this.afterPostAccept(m.id, post, allocateNow)
      return
    }
    const reason = outcome.reason === "declined" ? "decline" : "accept_timeout"
    this.sendCancelled(m, `accept_${outcome.reason}`)
    await this.sendMatchUpdate(m.id)
    for (const id of outcome.penalize) await this.d.cooldowns.issue(id, reason, m.id)
    for (const t of outcome.dropTickets) await this.d.queue.cancelTicket(t, reason)
    for (const t of outcome.requeueTickets) await this.d.queue.requeue(t)
    await this.d.queue.notifyParty(outcome.penalize)
    this.d.events?.emit("match", { event: "accept_failed", matchId: m.id, reason: outcome.reason, penalize: outcome.penalize })
  }

  // A resumed series keeps the maps already decided. The score starts at their map wins
  private async carryPriorMaps(tx: Db, m: MatchRow, prior: PriorMap[]): Promise<void> {
    if (!isSeries(m) || prior.length === 0) return
    const [cur] = await tx.select({ maps: matches.maps }).from(matches).where(eq(matches.id, m.id))
    await seedPriorMaps(tx, m.id, padMaps(cur?.maps ?? [], m.bestOf ?? 1), prior)
    const wins = mapWins(m.teams, await loadMapRows(tx, m.id))
    await tx.update(matches).set({ score: wins }).where(eq(matches.id, m.id))
  }

  private vetoPlan(m: MatchRow, game1Maps: string[] | null): { format: VetoFormat } | { maps: string[] } {
    const cfg = getModeConfig(m.mode)
    if (cfg.vetoFormat === "none") return { maps: [cfg.maps[0]!.id] }
    if (m.source === "tournament" && (m.bestOf ?? 1) >= 3) {
      if ((m.gameNumber ?? 1) === 1) return { format: "bo3-pickban" }
      if (game1Maps && game1Maps.length > 0) return { maps: game1Maps }
    }
    return { format: cfg.vetoFormat }
  }

  // Runs inside the accept transaction. Starts the veto or goes straight to allocation
  private async enterPostAccept(tx: Db, m: MatchRow): Promise<PostAccept> {
    let game1Maps: string[] | null = null
    // A later game or a resumed series plays the maps the first veto chose
    if (m.source === "tournament" && (m.gameNumber ?? 1) > 1 && m.tournamentId && m.bracketMatchKey) {
      const [g1] = await tx
        .select({ maps: matches.maps })
        .from(matches)
        .where(
          and(
            eq(matches.tournamentId, m.tournamentId),
            eq(matches.bracketMatchKey, m.bracketMatchKey),
            isNotNull(matches.maps),
          ),
        )
        .orderBy(desc(matches.createdAt))
        .limit(1)
      game1Maps = g1?.maps ?? null
    }
    const plan = this.vetoPlan(m, game1Maps)
    const nowDate = new Date(this.now())
    if ("maps" in plan) {
      const maps = isSeries(m) ? padMaps(plan.maps, m.bestOf ?? 1) : plan.maps
      const idx = Math.min(Math.max((m.gameNumber ?? 1) - 1, 0), maps.length - 1)
      const mapId = m.source === "tournament" && maps.length > 1 ? maps[idx]! : maps[0]!
      await tx
        .update(matches)
        .set({ status: "allocating", maps, mapId, allocationStartedAt: nowDate })
        .where(eq(matches.id, m.id))
      return { kind: "allocate" }
    }
    const state = createVeto({
      pool: getModeConfig(m.mode).maps.map((x) => x.id),
      teams: [
        { id: m.teams[0]!.name, steamIds: m.teams[0]!.steamIds },
        { id: m.teams[1]!.name, steamIds: m.teams[1]!.steamIds },
      ],
      format: plan.format,
      firstTeam: this.rng() < 0.5 ? 0 : 1,
    })
    const stepDeadline = this.now() + VETO_STEP_SEC * 1000
    await tx.insert(vetoes).values({ matchId: m.id, format: plan.format, state, stepDeadline: new Date(stepDeadline) })
    await tx.update(matches).set({ status: "veto" }).where(eq(matches.id, m.id))
    return { kind: "veto", state, stepDeadline }
  }

  // allocateNow false leaves the server start to the allocation loop
  private async afterPostAccept(matchId: string, post: PostAccept, allocateNow = true): Promise<void> {
    if (post.kind === "veto") {
      const [m] = await this.d.db.select().from(matches).where(eq(matches.id, matchId))
      if (m) this.sendVeto(m, post.state, post.stepDeadline)
    } else if (allocateNow) {
      await this.tryAllocate(matchId)
    }
  }

  // Each team only sees votes while its own team is acting
  private sendVeto(m: MatchRow, state: VetoState, stepDeadline: number | null): void {
    const acting = state.done ? null : state.steps[state.stepIndex]?.team ?? null
    m.teams.forEach((team, idx) => {
      const view: VetoState = acting === idx || acting === null ? state : { ...state, votes: {} }
      const payload: VetoStatePayload = { matchId: m.id, ...(m.slug ? { slug: m.slug } : {}), mode: m.mode, state: view, stepDeadline: state.done ? null : stepDeadline }
      toUsers(this.d.notifier, team.steamIds, "veto_state", payload)
    })
  }

  async vote(steamId: string, matchId: string, mapId: string): Promise<void> {
    const r = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m) throw notFound("match_not_found")
      if (m.status !== "veto") throw conflict("not_in_veto")
      const [row] = await tx.select().from(vetoes).where(eq(vetoes.matchId, matchId)).for("update")
      if (!row || row.done) throw conflict("not_in_veto")
      const state = row.state as VetoState
      let next: VetoState
      try {
        next = castVetoVote(state, steamId, mapId, this.rng)
      } catch (err) {
        if (err instanceof VetoError) throw badRequest("veto_rejected", err.message)
        throw err
      }
      const stepDeadline = next.stepIndex !== state.stepIndex ? this.now() + VETO_STEP_SEC * 1000 : row.stepDeadline!.getTime()
      await this.saveVeto(tx, m, next, stepDeadline)
      return { m, next, stepDeadline }
    })
    this.sendVeto(r.m, r.next, r.stepDeadline)
    if (r.next.done) await this.tryAllocate(matchId)
  }

  private async saveVeto(tx: Db, m: MatchRow, state: VetoState, stepDeadline: number): Promise<void> {
    await tx
      .update(vetoes)
      .set({ state, stepDeadline: state.done ? null : new Date(stepDeadline), done: state.done, updatedAt: new Date(this.now()) })
      .where(eq(vetoes.matchId, m.id))
    if (state.done) {
      const maps = isSeries(m) ? padMaps(state.maps, m.bestOf ?? 1) : state.maps
      await tx
        .update(matches)
        .set({ status: "allocating", maps, mapId: maps[0]!, allocationStartedAt: new Date(this.now()) })
        .where(eq(matches.id, m.id))
    }
  }

  // Allocates a server once the map is known. Retries from the tick until the timeout
  async tryAllocate(matchId: string): Promise<void> {
    await withLease(this.d.redis, `lock:alloc:${matchId}`, this.d.options.allocationLeaseMs ?? 60_000, async () => {
      const [m] = await this.d.db.select().from(matches).where(eq(matches.id, matchId))
      if (!m || m.status !== "allocating") return
      const started = m.allocationStartedAt?.getTime() ?? m.createdAt.getTime()
      const expired = this.now() - started > this.d.options.allocationTimeoutSec * 1000
      if (!this.d.options.allowUnresolvedModes && unresolvedConfig(m.mode).length > 0) {
        await this.cancelMatch(matchId, "mode_unavailable", { requeue: false })
        return
      }
      const map = m.mapId ? findMap(m.mode, m.mapId) : undefined
      if (!map) {
        await this.cancelMatch(matchId, "unknown_map", { requeue: true })
        return
      }
      const waitedMs = m.source === "tournament" ? Number.POSITIVE_INFINITY : this.now() - started
      // A series runs every map on this one server. The plugin changes level between maps
      const series = isSeries(m) ? seriesParams(m, await loadMapRows(this.d.db, matchId)) : undefined
      if (series === null) {
        await this.cancelMatch(matchId, "unknown_map", { requeue: true })
        return
      }
      try {
        const r = await this.d.allocator.allocate(
          {
            matchId,
            mode: m.mode,
            map,
            teams: m.teams,
            password: m.password!,
            webhookSecret: m.webhookSecret,
            ...(series ? { series } : {}),
          },
          waitedMs,
        )
        if (r.kind === "wait") {
          if (expired) await this.cancelMatch(matchId, "no_server", { requeue: true })
          return
        }
        const { response, demo } = r
        const connect = response.connect.includes("password") ? response.connect : `${response.connect}; password ${m.password}`
        // A DatHost boot is long and the plugin can report server_ready before start() returns.
        // Connect info is stored in any pre-live status and a held server_ready is released here
        const next = await this.tx(async (tx) => {
          const cur = await this.lock(tx, matchId)
          if (!cur || !PRE_LIVE.has(cur.status)) return null
          const readyNow = cur.status === "ready" || (cur.status === "allocating" && !!cur.readyAt)
          const status = readyNow ? "ready" : "starting"
          await tx
            .update(matches)
            .set({
              status,
              driver: r.driver,
              ...(r.driverRef ? { driverRef: r.driverRef } : {}),
              hostId: r.hostId,
              serverIp: response.ip,
              serverPort: response.port,
              connect,
              // The connect countdown starts when players get the address
              ...(readyNow ? { readyAt: new Date(this.now()) } : {}),
            })
            .where(eq(matches.id, matchId))
          return status
        })
        if (!next) {
          // The match ended while the server booted. Stop it so it does not run unowned
          this.d.log.warn({ matchId }, "server started for a match that already ended")
          await this.d.allocator.release(matchId, r.driver, true)
          return
        }
        // Series demos get a row per map still to play. Rows for maps never played go at the end
        const uploads = series && r.demos
          ? r.demos.map((d, i) => ({ mapNumber: i + 1, d })).filter((x) => x.mapNumber >= series.startMapNumber)
          : [{ mapNumber: 1, d: demo }]
        for (const { mapNumber, d } of uploads) {
          await this.d.db
            .insert(demos)
            .values({ matchId, mapNumber, bucket: d.bucket, key: d.key })
            .onConflictDoUpdate({ target: [demos.matchId, demos.mapNumber], set: { bucket: d.bucket, key: d.key } })
        }
        this.d.events?.emit("match", { event: "server_started", matchId, driver: r.driver, ip: response.ip, port: response.port })
        if (next === "ready") {
          const [fresh] = await this.d.db.select().from(matches).where(eq(matches.id, matchId))
          if (fresh) {
            this.sendServerReady(fresh)
            await this.matchChanged(fresh)
          }
        }
      } catch (err) {
        this.d.log.error({ err, matchId }, "server start failed")
        this.d.events?.record({ kind: "error", type: "allocation_error", message: (err as Error).message, matchId })
        if (expired) await this.cancelMatch(matchId, "server_start_failed", { requeue: true })
      }
    })
  }

  // Ends a match that never produced a result. Queue players can go back in the queue
  // deferRelease leaves the server stop to the allocation loop teardown
  async cancelMatch(matchId: string, reason: string, opts: { requeue: boolean; deferRelease?: boolean }): Promise<boolean> {
    const r = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m || TERMINAL.has(m.status)) return null
      await tx
        .update(matches)
        .set({ status: "cancelled", cancelReason: reason, endedAt: new Date(this.now()) })
        .where(eq(matches.id, matchId))
      return { m, players: await this.players(tx, matchId) }
    })
    if (!r) return false
    if (!opts.deferRelease) {
      await this.d.allocator.release(matchId, r.m.driver, true)
      await this.d.db.update(matches).set({ serverReleasedAt: new Date(this.now()) }).where(eq(matches.id, matchId))
    }
    const tickets = [...new Set(r.players.map((p) => p.ticketId).filter((t): t is string => !!t))]
    for (const t of tickets) {
      if (opts.requeue) await this.d.queue.requeue(t)
      else await this.d.queue.cancelTicket(t, reason)
    }
    await this.d.queue.notifyParty(r.players.map((p) => p.steamId))
    this.sendCancelled(r.m, reason)
    await this.sendMatchUpdate(matchId)
    this.d.events?.emit("match", { event: "match_cancelled", matchId, reason })
    await this.emitResult({ matchId, outcome: "cancelled", reason })
    return true
  }

  // Webhook events from the plugin. Idempotent for replays
  async handleEvent(matchId: string, event: MatchEvent): Promise<void> {
    const [m] = await this.d.db.select().from(matches).where(eq(matches.id, matchId))
    if (!m) throw notFound("match_not_found")
    // The demo upload report arrives after the match is over, so it is handled before the terminal check
    if (event.type === "demo_uploaded") {
      this.d.events?.record({ kind: "webhook", type: event.type, message: event.ok ? "demo stored" : `demo upload failed: ${event.error ?? "unknown"}`, matchId, ok: event.ok, detail: event })
      await this.d.db
        .update(demos)
        .set(event.ok ? { uploaded: true, deleteAfter: sql`now() + interval '30 days'` } : { uploaded: false })
        .where(and(eq(demos.matchId, matchId), eq(demos.mapNumber, event.mapNumber ?? 1)))
      // A series waits for the upload of its last played map
      if (TERMINAL.has(m.status) && (event.mapNumber ?? 1) >= (await this.lastDemoMap(matchId))) await this.teardown(matchId)
      return
    }
    // Kills are frequent so they stay out of the admin event log
    if (event.type === "kill") {
      if (!TERMINAL.has(m.status)) {
        await storeKill(this.d.db, matchId, event)
        await this.d.watchdog?.touch(matchId)
      }
      return
    }
    this.d.events?.record({ kind: "webhook", type: event.type, message: TERMINAL.has(m.status) ? `ignored, match is ${m.status}` : "accepted", matchId, ok: true, detail: event })
    if (TERMINAL.has(m.status)) return
    await this.d.watchdog?.touch(matchId)
    const db = this.d.db
    switch (event.type) {
      case "server_ready": {
        // Before start() returns there is no connect info. The ready moment is recorded and
        // tryAllocate moves the match to ready and tells players once the address is known
        const send = await this.tx(async (tx) => {
          const cur = await this.lock(tx, matchId)
          if (!cur || TERMINAL.has(cur.status)) return false
          if (cur.status === "allocating") {
            await tx.update(matches).set({ readyAt: new Date(this.now()) }).where(eq(matches.id, matchId))
            return false
          }
          if (cur.status === "starting") {
            await tx.update(matches).set({ status: "ready", readyAt: new Date(this.now()) }).where(eq(matches.id, matchId))
          }
          return true
        })
        if (!send) return
        const [fresh] = await db.select().from(matches).where(eq(matches.id, matchId))
        if (fresh) this.sendServerReady(fresh)
        if (fresh) await this.matchChanged(fresh)
        return
      }
      case "player_connected":
      case "player_disconnected": {
        const connected = event.type === "player_connected"
        await db
          .update(matchPlayers)
          .set(connected ? { connected: true, everConnected: true } : { connected: false })
          .where(and(eq(matchPlayers.matchId, matchId), eq(matchPlayers.steamId, event.steamId)))
        await this.sendWarmup(m)
        return
      }
      case "match_started": {
        if (isSeries(m)) await this.startSeriesMap(m, event.mapNumber ?? 1)
        await db
          .update(matches)
          .set({ status: "live", startedAt: new Date(this.now()) })
          .where(and(eq(matches.id, matchId), inArray(matches.status, ["starting", "ready"])))
        await this.sendMatchUpdate(matchId)
        return
      }
      case "round_end": {
        const arena = (event as { arena?: unknown }).arena
        const mapNumber = event.mapNumber ?? 1
        await db
          .insert(matchRounds)
          .values({
            matchId,
            mapNumber,
            round: event.round,
            winnerTeam: event.winnerTeam,
            score: event.score,
            arena: typeof arena === "string" ? arena : null,
            endedAt: new Date(this.now()),
          })
          .onConflictDoNothing()
        // A series keeps maps won on the match and the round score on the map
        if (isSeries(m)) await this.liveMapScore(m, mapNumber, event.score)
        else await db.update(matches).set({ score: event.score }).where(eq(matches.id, matchId))
        const [round] = await db
          .select()
          .from(matchRounds)
          .where(and(eq(matchRounds.matchId, matchId), eq(matchRounds.mapNumber, mapNumber), eq(matchRounds.round, event.round)))
        await this.sendMatchUpdate(matchId, round ? roundView(round, isSeries(m)) : undefined)
        return
      }
      case "rush_rooms_mismatch":
        // Recorded in the event log above. Nothing else acts on it until the room veto is switched on
        return
      case "map_end":
        await this.endSeriesMap(m, event)
        return
      case "match_end":
        await this.finishMatch(matchId, event)
        return
      case "match_abandoned":
        // A crashed server is nobody's fault. No rating change and no cooldown
        if (event.reason === SERVER_CRASHED || event.reason === MAP_LOAD_FAILED) {
          await this.cancelMatch(matchId, event.reason, { requeue: false })
        } else {
          await this.abandonMatch(matchId, event.missingSteamIds, event.reason)
        }
        return
    }
  }

  private async lastDemoMap(matchId: string): Promise<number> {
    const [row] = await this.d.db
      .select({ n: sql<number | null>`max(${demos.mapNumber})` })
      .from(demos)
      .where(eq(demos.matchId, matchId))
    return Number(row?.n ?? 0)
  }

  // A series map went live. Its row holds the round score until map_end
  private async startSeriesMap(m: MatchRow, mapNumber: number): Promise<void> {
    const mapId = padMaps(m.maps ?? [], m.bestOf ?? 1)[mapNumber - 1] ?? m.mapId ?? ""
    await this.d.db
      .insert(matchMaps)
      .values({ matchId: m.id, mapNumber, mapId, status: "live", startedAt: new Date(this.now()) })
      .onConflictDoNothing()
    await this.d.db.update(matches).set({ mapId }).where(eq(matches.id, m.id))
  }

  private async liveMapScore(m: MatchRow, mapNumber: number, score: Record<string, number>): Promise<void> {
    const mapId = padMaps(m.maps ?? [], m.bestOf ?? 1)[mapNumber - 1] ?? m.mapId ?? ""
    await this.d.db
      .insert(matchMaps)
      .values({ matchId: m.id, mapNumber, mapId, status: "live", score, startedAt: new Date(this.now()) })
      .onConflictDoUpdate({
        target: [matchMaps.matchId, matchMaps.mapNumber],
        set: { score },
        setWhere: sql`${matchMaps.status} = 'live'`,
      })
  }

  // One map of a series is over. The series ends here once a team has the wins it needs,
  // otherwise the server stays up and the plugin loads the next map
  private async endSeriesMap(m: MatchRow, event: Extract<MatchEvent, { type: "map_end" }>): Promise<void> {
    const r = await this.tx(async (tx) => {
      const cur = await this.lock(tx, m.id)
      if (!cur || TERMINAL.has(cur.status) || !isSeries(cur)) return null
      const [row] = await tx
        .select({ status: matchMaps.status })
        .from(matchMaps)
        .where(and(eq(matchMaps.matchId, m.id), eq(matchMaps.mapNumber, event.mapNumber)))
      if (row?.status === "done") return null
      const winner = cur.teams.some((t) => t.name === event.winnerTeam) ? event.winnerTeam : null
      // A drawn map counts for nobody and the series goes on
      if (!winner && event.winnerTeam !== DRAW_WINNER) this.d.log.warn({ matchId: m.id, mapNumber: event.mapNumber, winnerTeam: event.winnerTeam }, "series map ended without a winner")
      const done = {
        mapId: event.mapId,
        status: "done",
        winnerTeam: winner,
        score: event.score,
        players: toStatsJson(event.players),
        endedAt: new Date(this.now()),
      }
      await tx
        .insert(matchMaps)
        .values({ matchId: m.id, mapNumber: event.mapNumber, ...done })
        .onConflictDoUpdate({ target: [matchMaps.matchId, matchMaps.mapNumber], set: done })
      const rows = await loadMapRows(tx, m.id)
      const wins = mapWins(cur.teams, rows)
      const decided = seriesWinner(cur.bestOf ?? 1, wins)
      const nextMap = padMaps(cur.maps ?? [], cur.bestOf ?? 1)[event.mapNumber]
      await tx
        .update(matches)
        .set({ score: wins, ...(!decided && nextMap ? { mapId: nextMap } : {}) })
        .where(eq(matches.id, m.id))
      // Running totals so the match page shows series stats between maps
      for (const p of sumStats(rows)) {
        await tx
          .update(matchPlayers)
          .set({ kills: p.kills, deaths: p.deaths, headshots: p.headshots, damage: p.damage })
          .where(and(eq(matchPlayers.matchId, m.id), eq(matchPlayers.steamId, p.steamId)))
      }
      return { winner, decided, wins }
    })
    if (!r) return
    this.d.events?.emit("match", { event: "map_end", matchId: m.id, mapNumber: event.mapNumber, winnerTeam: r.winner })
    if (r.winner) await this.emitMapResult({ matchId: m.id, mapNumber: event.mapNumber, winnerTeam: r.winner })
    if (r.decided) {
      await this.finishMatch(m.id, { type: "match_end", winnerTeam: r.decided, score: r.wins, players: [], demoUploaded: false })
    } else {
      await this.sendMatchUpdate(m.id)
    }
  }

  // Final series result from the map rows. The plugin's maps list fills in any map_end that never arrived
  private async seriesOutcome(
    tx: Db,
    m: MatchRow,
    event: Extract<MatchEvent, { type: "match_end" }>,
  ): Promise<{ winnerTeam: string; score: Record<string, number>; players: MatchEndPlayers; maps: SeriesMapOutcome[] }> {
    for (const x of event.maps ?? []) {
      const winnerTeam = m.teams.some((t) => t.name === x.winnerTeam) ? x.winnerTeam : null
      await tx
        .insert(matchMaps)
        .values({ matchId: m.id, mapNumber: x.mapNumber, mapId: x.mapId, status: "done", winnerTeam, score: x.score, endedAt: new Date(this.now()) })
        .onConflictDoUpdate({
          target: [matchMaps.matchId, matchMaps.mapNumber],
          set: { mapId: x.mapId, status: "done", winnerTeam, score: x.score },
          setWhere: sql`${matchMaps.status} <> 'done'`,
        })
    }
    const rows = await loadMapRows(tx, m.id)
    const wins = mapWins(m.teams, rows)
    // The map rows decide. The plugin's winner counts only when maps are missing
    const winnerTeam = seriesWinner(m.bestOf ?? 1, wins) ?? event.winnerTeam
    const played = rows.filter((r) => !r.playedIn)
    const stats = sumStats(rows)
    const lastPlayed = played.reduce((n, r) => Math.max(n, r.mapNumber), 0)
    // Maps the series never reached have no demo
    await tx.delete(demos).where(and(eq(demos.matchId, m.id), gt(demos.mapNumber, Math.max(lastPlayed, m.gameNumber ?? 1))))
    return {
      winnerTeam,
      score: wins,
      players: stats.length > 0 ? stats : event.players,
      maps: rows
        .filter((r) => r.status === "done" && r.winnerTeam)
        .map((r) => ({ mapNumber: r.mapNumber, winnerTeam: r.winnerTeam!, matchId: r.playedIn ?? m.id })),
    }
  }

  // Live score for anyone following the match page
  async sendMatchUpdate(matchId: string, lastRound?: MatchRoundView): Promise<void> {
    const [m] = await this.d.db.select().from(matches).where(eq(matches.id, matchId))
    if (!m) return
    const payload: MatchUpdatePayload = {
      matchId,
      status: m.status as MatchStatus,
      teams: teamScores(m.teams, m.score),
      ...(lastRound ? { lastRound } : {}),
    }
    if (isSeries(m)) {
      const maps = mapViews(m, await loadMapRows(this.d.db, matchId))
      const live = maps.find((x) => x.status === "live")
      payload.maps = maps
      if (live) payload.mapNumber = live.mapNumber
    }
    this.d.notifier.send({ kind: "match", matchId }, { type: "match_update", payload, ts: Date.now() })
    await this.matchChanged(m)
  }

  // Warm-up progress for the connect card
  private async sendWarmup(m: MatchRow): Promise<void> {
    const rows = await this.players(this.d.db, m.id)
    const payload: MatchUpdatePayload = {
      matchId: m.id,
      status: m.status as MatchStatus,
      teams: teamScores(m.teams, m.score),
      connected: rows.filter((p) => p.connected).length,
      expected: this.allSteamIds(m).length,
    }
    toUsers(this.d.notifier, this.allSteamIds(m), "match_update", payload)
  }

  private sendCancelled(m: MatchRow, reason: string): void {
    const payload: MatchCancelledPayload = { matchId: m.id, reason }
    toUsers(this.d.notifier, this.allSteamIds(m), "match_cancelled", payload)
  }

  private sendServerReady(m: MatchRow): void {
    if (!m.serverIp || !m.serverPort || !m.connect) return
    const payload: ServerReadyPayload = {
      matchId: m.id,
      ...(m.slug ? { slug: m.slug } : {}),
      ip: m.serverIp,
      port: m.serverPort,
      password: m.password ?? "",
      connect: m.connect,
      mapId: m.mapId ?? "",
    }
    toUsers(this.d.notifier, this.allSteamIds(m), "server_ready", payload)
  }

  async finishMatch(matchId: string, event: Extract<MatchEvent, { type: "match_end" }>): Promise<void> {
    const r = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m || TERMINAL.has(m.status) || m.ratingApplied) return null
      // A series is rated once on its result. Score is maps won and stats are totals
      const series = isSeries(m) ? await this.seriesOutcome(tx, m, event) : null
      const result = series ?? { winnerTeam: event.winnerTeam, score: event.score, players: event.players }
      // A draw or an unknown team name leaves ratings alone
      const winnerIdx = result.winnerTeam === DRAW_WINNER ? -1 : m.teams.findIndex((t) => t.name === result.winnerTeam)
      const nowDate = new Date(this.now())
      await tx
        .update(matches)
        .set({
          status: "finished",
          winnerTeam: winnerIdx >= 0 ? result.winnerTeam : null,
          score: result.score,
          endedAt: nowDate,
          ratingApplied: winnerIdx >= 0,
        })
        .where(eq(matches.id, matchId))
      const stats = new Map(result.players.map((p) => [p.steamId, p]))
      for (const [idx, team] of m.teams.entries()) {
        for (const steamId of team.steamIds) {
          const s = stats.get(steamId)
          await tx
            .update(matchPlayers)
            .set({
              won: winnerIdx < 0 ? null : winnerIdx === idx,
              kills: s?.kills ?? null,
              deaths: s?.deaths ?? null,
              headshots: s?.headshots ?? null,
              damage: s?.damage ?? null,
            })
            .where(and(eq(matchPlayers.matchId, matchId), eq(matchPlayers.steamId, steamId)))
        }
      }
      const changes =
        winnerIdx >= 0
          ? await this.d.ratings.applyMatch(
              {
                matchId,
                mode: m.mode,
                teams: [m.teams[0]!.steamIds, m.teams[1]!.steamIds],
                scoreA: winnerIdx === 0 ? 1 : 0,
                source: m.source,
              },
              tx,
            )
          : []
      // The upload itself is confirmed later by a demo_uploaded event
      if (!series) {
        await tx
          .insert(demos)
          .values({ matchId, bucket: "unknown", key: demoKey(matchId, m.createdAt) })
          .onConflictDoNothing()
      }
      return { m, changes, winner: winnerIdx >= 0 ? result.winnerTeam : null, score: result.score, maps: series?.maps }
    })
    // The server stays up until the demo upload is reported. See teardown
    if (!r) return
    const payload: MatchResultPayload = {
      matchId,
      mode: r.m.mode,
      status: "completed",
      winnerTeam: r.winner,
      score: r.score,
      ratingChanges: r.changes,
    }
    toUsers(this.d.notifier, this.allSteamIds(r.m), "match_result", payload)
    await this.sendMatchUpdate(matchId)
    await this.d.trust.recomputeMany(this.allSteamIds(r.m))
    await this.emitResult({
      matchId,
      outcome: "completed",
      winnerTeam: r.winner ?? DRAW_WINNER,
      score: r.score,
      ...(r.maps ? { maps: r.maps } : {}),
    })
  }

  // Stops the server once the match is over. DatHost demos are pulled first because deleting the clone deletes them
  async teardown(matchId: string): Promise<void> {
    await withLock(this.d.redis, `lock:teardown:${matchId}`, 120_000, async () => {
      const [m] = await this.d.db.select().from(matches).where(eq(matches.id, matchId))
      if (!m || m.serverReleasedAt || !TERMINAL.has(m.status)) return
      if (m.driver === "dathost" && m.status !== "cancelled") await this.collectSurgeDemo(m)
      await this.d.allocator.release(matchId, m.driver, true)
      await this.d.db.update(matches).set({ serverReleasedAt: new Date(this.now()) }).where(eq(matches.id, matchId))
    })
  }

  private async collectSurgeDemo(m: MatchRow): Promise<void> {
    const rows = await this.d.db.select().from(demos).where(eq(demos.matchId, m.id)).orderBy(asc(demos.mapNumber))
    // A series has one demo per played map on the same server
    const targets = rows.length > 0 ? rows.map((d) => ({ mapNumber: d.mapNumber, key: d.key })) : [{ mapNumber: 1, key: demoKey(m.id, m.createdAt) }]
    for (const t of targets) {
      try {
        if (await this.d.allocator.collectDemo(m.id, m.driver, t.key, isSeries(m) ? t.mapNumber : undefined)) {
          await this.d.db
            .update(demos)
            .set({ uploaded: true })
            .where(and(eq(demos.matchId, m.id), eq(demos.mapNumber, t.mapNumber)))
        }
      } catch (err) {
        this.d.log.error({ err, matchId: m.id, mapNumber: t.mapNumber }, "surge demo collection failed")
        this.d.events?.record({ kind: "error", type: "demo_fetch_failed", message: (err as Error).message, matchId: m.id })
      }
    }
  }

  // Missing players forfeit. Penalties need proof the server was reachable. A missing player gets a
  // cooldown only when someone on the other team connected, and a forfeit is rated only when the
  // winning side connected. Winners who never connected and the forfeiters' teammates stay unrated
  async abandonMatch(matchId: string, missingSteamIds: string[], reason: string): Promise<void> {
    const r = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m || TERMINAL.has(m.status) || m.ratingApplied) return null
      const players = await this.players(tx, matchId)
      const inMatch = new Set(players.map((p) => p.steamId))
      const joined = new Set(players.filter((p) => p.everConnected).map((p) => p.steamId))
      const missing = missingSteamIds.filter((s) => inMatch.has(s))
      const teams: [string[], string[]] = [m.teams[0]!.steamIds, m.teams[1]!.steamIds]
      const outcome = resolveAbandon(teams, missing)
      const teamConnected = (idx: number) => teams[idx]!.some((s) => joined.has(s))
      const otherTeam = (steamId: string) => (teams[0].includes(steamId) ? 1 : 0)
      const penalized = outcome.forfeiters.filter((s) => teamConnected(otherTeam(s)))
      const endReason = joined.size === 0 ? SERVER_UNREACHABLE : reason
      const nowDate = new Date(this.now())
      let changes: RatingChange[] = []
      let winnerTeam: string | null = null
      const winnerIdx: 0 | 1 = outcome.kind === "forfeit" && outcome.loserTeam === 0 ? 1 : 0
      const rated = outcome.kind === "forfeit" && teamConnected(winnerIdx)
      if (outcome.kind === "forfeit" && rated) {
        winnerTeam = m.teams[winnerIdx]!.name
        const loserTeammates = teams[outcome.loserTeam].filter((s) => !outcome.forfeiters.includes(s))
        const absentWinners = teams[winnerIdx].filter((s) => !joined.has(s))
        changes = await this.d.ratings.applyMatch(
          {
            matchId,
            mode: m.mode,
            teams,
            scoreA: outcome.loserTeam === 0 ? 0 : 1,
            forfeiters: outcome.forfeiters,
            exclude: [...loserTeammates, ...absentWinners],
            source: m.source,
          },
          tx,
        )
        for (const [idx, team] of teams.entries()) {
          await tx
            .update(matchPlayers)
            .set({ won: idx === winnerIdx })
            .where(and(eq(matchPlayers.matchId, matchId), inArray(matchPlayers.steamId, team)))
        }
      }
      if (penalized.length > 0) {
        await tx
          .update(matchPlayers)
          .set({ abandoned: true })
          .where(and(eq(matchPlayers.matchId, matchId), inArray(matchPlayers.steamId, penalized)))
      }
      await tx
        .update(matches)
        .set({
          status: outcome.forfeiters.length > 0 ? "abandoned" : "cancelled",
          winnerTeam,
          cancelReason: endReason,
          endedAt: nowDate,
          ratingApplied: rated,
        })
        .where(eq(matches.id, matchId))
      return { m, outcome, penalized, changes, winnerTeam, joined, endReason }
    })
    if (!r) return
    for (const id of r.penalized) {
      await this.d.cooldowns.issue(id, r.joined.has(id) ? "abandon" : "no_connect", matchId)
    }
    const payload: MatchResultPayload = {
      matchId,
      mode: r.m.mode,
      status: "abandoned",
      winnerTeam: r.winnerTeam,
      score: r.m.score ?? {},
      ratingChanges: r.changes,
    }
    toUsers(this.d.notifier, this.allSteamIds(r.m), "match_result", payload)
    if (r.m.status !== "live") this.sendCancelled(r.m, r.endReason)
    await this.sendMatchUpdate(matchId)
    await this.d.queue.notifyParty(this.allSteamIds(r.m))
    this.d.events?.emit("match", {
      event: "match_abandoned",
      matchId,
      reason: r.endReason,
      forfeiters: r.outcome.forfeiters,
      penalized: r.penalized,
    })
    await this.emitResult({ matchId, outcome: "abandoned", reason: r.endReason, missingSteamIds: r.outcome.forfeiters })
  }

  // Watchdog end for a match whose server vanished or that ran past its cap.
  // Nobody is at fault. No rating change and no cooldown, and slot and token go back at once
  async endLost(matchId: string, reason: WatchdogReason, detail?: string): Promise<boolean> {
    const r = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m || !isWatched(m.status) || m.ratingApplied) return null
      await tx
        .update(matches)
        .set({ status: "abandoned", winnerTeam: null, cancelReason: reason, endedAt: new Date(this.now()) })
        .where(eq(matches.id, matchId))
      return m
    })
    if (!r) return false
    this.d.log.warn({ matchId, reason, detail, status: r.status, driver: r.driver }, "watchdog ended match")
    this.d.events?.record({ kind: "error", type: `match_${reason}`, message: detail ?? reason, matchId })
    if (reason === MATCH_TIMEOUT) {
      // The server may still run. Teardown pulls a surge demo first
      await this.teardown(matchId)
    } else {
      await this.d.allocator.release(matchId, r.driver, true)
      await this.d.db.update(matches).set({ serverReleasedAt: new Date(this.now()) }).where(eq(matches.id, matchId))
    }
    await this.d.watchdog?.forget(matchId)
    const everyone = this.allSteamIds(r)
    const payload: MatchResultPayload = {
      matchId,
      mode: r.mode,
      status: "abandoned",
      winnerTeam: null,
      score: r.score ?? {},
      ratingChanges: [],
    }
    toUsers(this.d.notifier, everyone, "match_result", payload)
    this.sendCancelled(r, reason)
    await this.sendMatchUpdate(matchId)
    await this.d.queue.notifyParty(everyone)
    this.d.events?.emit("match", { event: "match_abandoned", matchId, reason, forfeiters: [] })
    await this.emitResult({ matchId, outcome: "abandoned", reason, missingSteamIds: [] })
    return true
  }

  // One watchdog pass. Runs from the allocation loop and once at boot
  async runWatchdog(): Promise<string[]> {
    const w = this.d.watchdog
    if (!w) return []
    this.lastWatchdogRun = this.now()
    const ended: string[] = []
    for (const v of await w.inspect()) {
      await this.guard(v.matchId, async () => {
        if (await this.endLost(v.matchId, v.reason, v.detail)) ended.push(v.matchId)
      })
    }
    return ended
  }

  // Boot recovery. Matches whose server died while the API was down end the same way
  async recover(): Promise<string[]> {
    return this.runWatchdog()
  }

  // Both loops in one pass. Tests and scripts use it
  async tick(): Promise<void> {
    await this.timersTick()
    await this.allocationTick()
  }

  // Deadlines only: accept windows, veto steps, players who never connect and cooldown expiry.
  // Postgres and Redis only, so a slow host never delays a countdown
  async timersTick(): Promise<void> {
    const nowDate = new Date(this.now())
    const db = this.d.db

    const expiredAccept = await db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.status, "accepting"), lt(matches.acceptDeadline, nowDate)))
    for (const { id } of expiredAccept) await this.guard(id, () => this.expireAccept(id, false))

    const dueVetoes = await db
      .select({ matchId: vetoes.matchId })
      .from(vetoes)
      .where(and(eq(vetoes.done, false), lt(vetoes.stepDeadline, nowDate)))
    for (const { matchId } of dueVetoes) await this.guard(matchId, () => this.expireVetoStep(matchId, false))

    const connectCutoff = new Date(this.now() - this.d.options.connectTimeoutSec * 1000)
    const stale = await db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.status, "ready"), lt(matches.readyAt, connectCutoff)))
    for (const { id } of stale) await this.guard(id, () => this.expireConnect(id))

    const startCutoff = new Date(
      this.now() - (this.d.options.allocationTimeoutSec + this.d.options.connectTimeoutSec) * 1000,
    )
    const stuck = await db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.status, "starting"), lt(matches.allocationStartedAt, startCutoff)))
    for (const { id } of stuck) {
      await this.guard(id, () => this.cancelMatch(id, "server_never_ready", { requeue: false, deferRelease: true }))
    }

    await this.guard("cooldowns", () => this.sweepCooldowns())
  }

  // Pushes a fresh queue status to players whose cooldown ended since the last sweep
  private async sweepCooldowns(): Promise<void> {
    const now = this.now()
    const since = this.lastCooldownSweep ?? now - 5000
    this.lastCooldownSweep = now
    const rows = await this.d.db
      .selectDistinct({ steamId: cooldowns.steamId })
      .from(cooldowns)
      .where(and(gt(cooldowns.endsAt, new Date(since)), lte(cooldowns.endsAt, new Date(now))))
    if (rows.length > 0) await this.d.queue.notifyParty(rows.map((r) => r.steamId))
  }

  // Agent and DatHost calls: server starts and teardowns, a few at a time
  async allocationTick(concurrency = ALLOCATION_CONCURRENCY): Promise<void> {
    const db = this.d.db
    const allocating = await db.select({ id: matches.id }).from(matches).where(eq(matches.status, "allocating"))
    const demoCutoff = new Date(this.now() - this.d.options.demoWaitSec * 1000)
    const ended = await db
      .select({ id: matches.id })
      .from(matches)
      .where(
        and(
          isNull(matches.serverReleasedAt),
          or(
            and(inArray(matches.status, ["finished", "abandoned"]), lt(matches.endedAt, demoCutoff)),
            // Cancelled by the timers loop with a server or slot still held
            and(
              eq(matches.status, "cancelled"),
              or(isNotNull(matches.hostId), isNotNull(matches.slotId), isNotNull(matches.driverRef)),
            ),
          ),
        ),
      )
    const jobs: (() => Promise<void>)[] = [
      ...allocating.map(({ id }) => () => this.guard(id, () => this.tryAllocate(id))),
      ...ended.map(({ id }) => () => this.guard(id, () => this.teardown(id))),
    ]
    const w = this.d.watchdog
    if (w && (this.lastWatchdogRun === null || this.now() - this.lastWatchdogRun >= w.options.intervalSec * 1000)) {
      this.lastWatchdogRun = this.now()
      jobs.push(() => this.guard("watchdog", () => this.runWatchdog()))
    }
    await eachLimit(jobs, concurrency, (job) => job())
  }

  private async guard(matchId: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      this.d.log.error({ err, matchId }, "match tick step failed")
      this.d.events?.record({ kind: "error", type: "tick_error", message: (err as Error).message, matchId })
    }
  }

  async expireAccept(matchId: string, allocateNow = true): Promise<void> {
    const r = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m || m.status !== "accepting") return null
      if (m.acceptDeadline && m.acceptDeadline.getTime() >= this.now()) return null
      const outcome = resolveAccept(await this.players(tx, matchId), true)
      const post = await this.applyAcceptOutcome(tx, m, outcome)
      return { m, outcome, post }
    })
    if (r) await this.afterAccept(r.m, r.outcome, r.post, allocateNow)
  }

  // Resolves the current step with the votes cast so far. No votes means a random ban
  async expireVetoStep(matchId: string, allocateNow = true): Promise<void> {
    const r = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m || m.status !== "veto") return null
      const [row] = await tx.select().from(vetoes).where(eq(vetoes.matchId, matchId)).for("update")
      if (!row || row.done || !row.stepDeadline || row.stepDeadline.getTime() > this.now()) return null
      const next = resolveStep(row.state as VetoState, this.rng)
      const stepDeadline = this.now() + VETO_STEP_SEC * 1000
      await this.saveVeto(tx, m, next, stepDeadline)
      return { m, next, stepDeadline }
    })
    if (!r) return
    this.sendVeto(r.m, r.next, r.stepDeadline)
    if (r.next.done && allocateNow) await this.tryAllocate(matchId)
  }

  private async expireConnect(matchId: string): Promise<void> {
    const players = await this.d.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    const missing = players.filter((p) => !p.everConnected).map((p) => p.steamId)
    if (missing.length === 0) await this.cancelMatch(matchId, "never_started", { requeue: false, deferRelease: true })
    else await this.abandonMatch(matchId, missing, "connect_timeout")
  }

  async activeMatchFor(steamId: string): Promise<MatchRow | null> {
    const [row] = await this.d.db
      .select({ m: matches })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.steamId, steamId), inArray(matches.status, [...ACTIVE_MATCH_STATUSES])))
      .orderBy(desc(matches.createdAt))
      .limit(1)
    return row?.m ?? null
  }

  async playersOf(matchId: string): Promise<PlayerRow[]> {
    return this.players(this.d.db, matchId)
  }

  // Re-sends the live match state to one player, used when a socket connects
  async resendState(steamId: string): Promise<void> {
    const m = await this.activeMatchFor(steamId)
    if (!m) return
    if (m.status === "accepting") {
      const players = await this.players(this.d.db, m.id)
      this.sendMatchFound([steamId], {
        matchId: m.id,
        slug: m.slug,
        mode: m.mode,
        acceptDeadline: m.acceptDeadline?.getTime() ?? this.now(),
        accepted: players.filter((p) => p.accepted).length,
        required: players.length,
      })
    } else if (m.status === "veto") {
      const [row] = await this.d.db.select().from(vetoes).where(eq(vetoes.matchId, m.id))
      if (row) {
        const state = row.state as VetoState
        const idx = m.teams.findIndex((t) => t.steamIds.includes(steamId))
        const acting = state.steps[state.stepIndex]?.team
        const view = acting === idx ? state : { ...state, votes: {} }
        const payload: VetoStatePayload = {
          matchId: m.id,
          ...(m.slug ? { slug: m.slug } : {}),
          mode: m.mode,
          state: view,
          stepDeadline: row.stepDeadline?.getTime() ?? null,
        }
        toUsers(this.d.notifier, [steamId], "veto_state", payload)
      }
    } else if ((m.status === "ready" || m.status === "live") && m.connect && m.serverIp && m.serverPort) {
      const payload: ServerReadyPayload = {
        matchId: m.id,
        ...(m.slug ? { slug: m.slug } : {}),
        ip: m.serverIp,
        port: m.serverPort,
        password: m.password ?? "",
        connect: m.connect,
        mapId: m.mapId ?? "",
      }
      toUsers(this.d.notifier, [steamId], "server_ready", payload)
    }
  }
}

type PostAccept = { kind: "veto"; state: VetoState; stepDeadline: number } | { kind: "allocate" }

type MatchEndPlayers = Extract<MatchEvent, { type: "match_end" }>["players"]
