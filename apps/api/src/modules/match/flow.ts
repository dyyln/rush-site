import { randomUUID } from "node:crypto"
import {
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
import { cooldowns, demos, matchPlayers, matchRounds, matches, vetoes, type TeamRosterJson } from "../../db/schema.js"
import type { Rng } from "../../lib/clock.js"
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js"
import type { EventLog } from "../../lib/event-log.js"
import { randomPassword, randomToken } from "../../lib/hmac.js"
import { withLock } from "../../lib/redis.js"
import type { CooldownService } from "../queue/cooldowns.js"
import { ACTIVE_MATCH_STATUSES, type LiveTicket, type QueueService } from "../queue/service.js"
import type { RatingService } from "../rating/service.js"
import type { TrustService } from "../trust/service.js"
import { toUsers, type Notifier } from "../ws/hub.js"
import { resolveAbandon, resolveAccept, type AcceptOutcome } from "./accept.js"
import type { Allocator } from "./allocator.js"
import { roundView, teamScores } from "./match-page.js"
import { storeKill } from "./extras.js"
import { demoKey } from "./storage.js"

type MatchRow = typeof matches.$inferSelect
type PlayerRow = typeof matchPlayers.$inferSelect

export type MatchResultEvent =
  | { matchId: string; outcome: "completed"; winnerTeam: string; score: Record<string, number> }
  | { matchId: string; outcome: "abandoned"; reason: string; missingSteamIds: string[] }
  | { matchId: string; outcome: "cancelled"; reason: string }

export type ResultListener = (result: MatchResultEvent) => Promise<void>

export type TournamentMatchParams = {
  mode: Mode
  teams: [{ name: string; steamIds: string[] }, { name: string; steamIds: string[] }]
  source: { kind: "tournament"; tournamentId: string; bracketMatchId: string; gameNumber: number; bestOf: number }
}

export type FlowOptions = {
  allocationTimeoutSec: number
  connectTimeoutSec: number
  // Server teardown waits this long for demo_uploaded after the match ends
  demoWaitSec: number
  allowUnresolvedModes?: boolean
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
  now?: () => number
  rng?: Rng
  options: FlowOptions
}

export const SERVER_CRASHED = "server_crashed"

const TERMINAL = new Set(["finished", "abandoned", "cancelled"])

export const ALLOCATION_CONCURRENCY = 4

// Runs fn over items with at most limit calls in flight
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// Match lifecycle from match found to result. Postgres rows are the state, row locks serialise changes
export class MatchFlow {
  private readonly listeners: ResultListener[] = []
  private readonly playerHooks: ((steamIds: string[]) => Promise<void>)[] = []
  private readonly matchHooks: ((m: MatchRow) => Promise<void>)[] = []
  private readonly now: () => number
  private readonly rng: Rng
  private lastCooldownSweep: number | null = null

  constructor(private readonly d: FlowDeps) {
    this.now = d.now ?? Date.now
    this.rng = d.rng ?? Math.random
  }

  onResult(listener: ResultListener): void {
    this.listeners.push(listener)
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
    this.sendMatchFound(rosters.flatMap((r) => r.steamIds), { matchId, mode, acceptDeadline: deadline, accepted: 0, required: total })
    this.d.events?.emit("match", { event: "match_found", matchId, mode, teams: rosters })
    await this.playersChanged(rosters.flatMap((r) => r.steamIds))
    return { ok: true, matchId }
  }

  private sendMatchFound(
    steamIds: string[],
    p: { matchId: string; mode: Mode; acceptDeadline: number; accepted: number; required: number },
  ): void {
    const payload: MatchFoundPayload = { ...p, acceptWindowSec: ACCEPT_WINDOW_SEC }
    toUsers(this.d.notifier, steamIds, "match_found", payload)
  }

  // Tournament path. Skips queue and accept. Throws when no server slot is free so the caller retries
  async createTournamentMatch(params: TournamentMatchParams): Promise<{ matchId: string }> {
    const matchId = randomUUID()
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
            teams: params.teams.map((t) => ({ name: t.name, steamIds: [...t.steamIds] })),
            tournamentId: params.source.tournamentId,
            bracketMatchKey: params.source.bracketMatchId,
            gameNumber: params.source.gameNumber,
            bestOf: params.source.bestOf,
            hostId: reservation?.hostId ?? null,
            slotId: reservation?.slotId ?? null,
            gsltId: reservation?.gsltId ?? null,
            webhookSecret: randomToken(32),
            password: randomPassword(),
            createdAt: new Date(this.now()),
          })
          .returning()
        await tx.insert(matchPlayers).values(
          params.teams.flatMap((t, idx) => t.steamIds.map((steamId) => ({ matchId, steamId, team: idx, accepted: true }))),
        )
        return this.enterPostAccept(tx, m!)
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
      this.sendMatchFound(everyone, { matchId: m.id, mode: m.mode, acceptDeadline: deadline, ...outcome })
      return
    }
    if (outcome.kind === "all_accepted") {
      this.sendMatchFound(everyone, {
        matchId: m.id,
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
    if (m.source === "tournament" && (m.gameNumber ?? 1) > 1 && m.tournamentId && m.bracketMatchKey) {
      const [g1] = await tx
        .select({ maps: matches.maps })
        .from(matches)
        .where(
          and(
            eq(matches.tournamentId, m.tournamentId),
            eq(matches.bracketMatchKey, m.bracketMatchKey),
            eq(matches.gameNumber, 1),
          ),
        )
        .orderBy(desc(matches.createdAt))
        .limit(1)
      game1Maps = g1?.maps ?? null
    }
    const plan = this.vetoPlan(m, game1Maps)
    const nowDate = new Date(this.now())
    if ("maps" in plan) {
      const idx = Math.min(Math.max((m.gameNumber ?? 1) - 1, 0), plan.maps.length - 1)
      const mapId = m.source === "tournament" && plan.maps.length > 1 ? plan.maps[idx]! : plan.maps[0]!
      await tx
        .update(matches)
        .set({ status: "allocating", maps: plan.maps, mapId, allocationStartedAt: nowDate })
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
      const payload: VetoStatePayload = { matchId: m.id, mode: m.mode, state: view, stepDeadline: state.done ? null : stepDeadline }
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
      const maps = state.maps
      await tx
        .update(matches)
        .set({ status: "allocating", maps, mapId: maps[0]!, allocationStartedAt: new Date(this.now()) })
        .where(eq(matches.id, m.id))
    }
  }

  // Allocates a server once the map is known. Retries from the tick until the timeout
  async tryAllocate(matchId: string): Promise<void> {
    await withLock(this.d.redis, `lock:alloc:${matchId}`, 60_000, async () => {
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
      try {
        const r = await this.d.allocator.allocate(
          { matchId, mode: m.mode, map, teams: m.teams, password: m.password!, webhookSecret: m.webhookSecret },
          waitedMs,
        )
        if (r.kind === "wait") {
          if (expired) await this.cancelMatch(matchId, "no_server", { requeue: true })
          return
        }
        const { response, demo } = r
        const connect = response.connect.includes("password") ? response.connect : `${response.connect}; password ${m.password}`
        await this.d.db
          .update(matches)
          .set({
            status: "starting",
            driver: r.driver,
            ...(r.driverRef ? { driverRef: r.driverRef } : {}),
            hostId: r.hostId,
            serverIp: response.ip,
            serverPort: response.port,
            connect,
          })
          .where(and(eq(matches.id, matchId), eq(matches.status, "allocating")))
        await this.d.db
          .insert(demos)
          .values({ matchId, bucket: demo.bucket, key: demo.key })
          .onConflictDoUpdate({ target: demos.matchId, set: { bucket: demo.bucket, key: demo.key } })
        this.d.events?.emit("match", { event: "server_started", matchId, driver: r.driver, ip: response.ip, port: response.port })
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
        .where(eq(demos.matchId, matchId))
      if (TERMINAL.has(m.status)) await this.teardown(matchId)
      return
    }
    // Kills are frequent so they stay out of the admin event log
    if (event.type === "kill") {
      if (!TERMINAL.has(m.status)) await storeKill(this.d.db, matchId, event)
      return
    }
    this.d.events?.record({ kind: "webhook", type: event.type, message: TERMINAL.has(m.status) ? `ignored, match is ${m.status}` : "accepted", matchId, ok: true, detail: event })
    if (TERMINAL.has(m.status)) return
    const db = this.d.db
    switch (event.type) {
      case "server_ready": {
        if (m.status === "starting" || m.status === "allocating") {
          await db
            .update(matches)
            .set({ status: "ready", readyAt: new Date(this.now()) })
            .where(eq(matches.id, matchId))
        }
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
        return
      }
      case "match_started": {
        await db
          .update(matches)
          .set({ status: "live", startedAt: new Date(this.now()) })
          .where(and(eq(matches.id, matchId), inArray(matches.status, ["starting", "ready"])))
        await this.sendMatchUpdate(matchId)
        return
      }
      case "round_end": {
        const arena = (event as { arena?: unknown }).arena
        await db
          .insert(matchRounds)
          .values({
            matchId,
            round: event.round,
            winnerTeam: event.winnerTeam,
            score: event.score,
            arena: typeof arena === "string" ? arena : null,
            endedAt: new Date(this.now()),
          })
          .onConflictDoNothing()
        await db.update(matches).set({ score: event.score }).where(eq(matches.id, matchId))
        const [round] = await db
          .select()
          .from(matchRounds)
          .where(and(eq(matchRounds.matchId, matchId), eq(matchRounds.round, event.round)))
        await this.sendMatchUpdate(matchId, round ? roundView(round) : undefined)
        return
      }
      case "match_end":
        await this.finishMatch(matchId, event)
        return
      case "match_abandoned":
        // A crashed server is nobody's fault. No rating change and no cooldown
        if (event.reason === SERVER_CRASHED) await this.cancelMatch(matchId, SERVER_CRASHED, { requeue: false })
        else await this.abandonMatch(matchId, event.missingSteamIds, event.reason)
        return
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
    this.d.notifier.send({ kind: "match", matchId }, { type: "match_update", payload, ts: Date.now() })
    await this.matchChanged(m)
  }

  private sendCancelled(m: MatchRow, reason: string): void {
    const payload: MatchCancelledPayload = { matchId: m.id, reason }
    toUsers(this.d.notifier, this.allSteamIds(m), "match_cancelled", payload)
  }

  private sendServerReady(m: MatchRow): void {
    if (!m.serverIp || !m.serverPort || !m.connect) return
    const payload: ServerReadyPayload = {
      matchId: m.id,
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
      // A draw or an unknown team name leaves ratings alone
      const winnerIdx = event.winnerTeam === DRAW_WINNER ? -1 : m.teams.findIndex((t) => t.name === event.winnerTeam)
      const nowDate = new Date(this.now())
      await tx
        .update(matches)
        .set({
          status: "finished",
          winnerTeam: winnerIdx >= 0 ? event.winnerTeam : null,
          score: event.score,
          endedAt: nowDate,
          ratingApplied: winnerIdx >= 0,
        })
        .where(eq(matches.id, matchId))
      const stats = new Map(event.players.map((p) => [p.steamId, p]))
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
      await tx
        .insert(demos)
        .values({ matchId, bucket: "unknown", key: demoKey(matchId, m.createdAt) })
        .onConflictDoNothing()
      return { m, changes, winner: winnerIdx >= 0 ? event.winnerTeam : null }
    })
    // The server stays up until the demo upload is reported. See teardown
    if (!r) return
    const payload: MatchResultPayload = {
      matchId,
      mode: r.m.mode,
      status: "completed",
      winnerTeam: r.winner,
      score: event.score,
      ratingChanges: r.changes,
    }
    toUsers(this.d.notifier, this.allSteamIds(r.m), "match_result", payload)
    await this.sendMatchUpdate(matchId)
    await this.d.trust.recomputeMany(this.allSteamIds(r.m))
    await this.emitResult({ matchId, outcome: "completed", winnerTeam: r.winner ?? DRAW_WINNER, score: event.score })
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
    try {
      const [demo] = await this.d.db.select().from(demos).where(eq(demos.matchId, m.id))
      const key = demo?.key ?? demoKey(m.id, m.createdAt)
      if (await this.d.allocator.collectDemo(m.id, m.driver, key)) {
        await this.d.db.update(demos).set({ uploaded: true }).where(eq(demos.matchId, m.id))
      }
    } catch (err) {
      this.d.log.error({ err, matchId: m.id }, "surge demo collection failed")
      this.d.events?.record({ kind: "error", type: "demo_fetch_failed", message: (err as Error).message, matchId: m.id })
    }
  }

  // Missing players forfeit and take the loss. Their teammates are left unrated
  async abandonMatch(matchId: string, missingSteamIds: string[], reason: string): Promise<void> {
    const r = await this.tx(async (tx) => {
      const m = await this.lock(tx, matchId)
      if (!m || TERMINAL.has(m.status) || m.ratingApplied) return null
      const players = await this.players(tx, matchId)
      const inMatch = new Set(players.map((p) => p.steamId))
      const missing = missingSteamIds.filter((s) => inMatch.has(s))
      const teams: [string[], string[]] = [m.teams[0]!.steamIds, m.teams[1]!.steamIds]
      const outcome = resolveAbandon(teams, missing)
      const nowDate = new Date(this.now())
      let changes: RatingChange[] = []
      let winnerTeam: string | null = null
      if (outcome.kind === "forfeit") {
        const winnerIdx = outcome.loserTeam === 0 ? 1 : 0
        winnerTeam = m.teams[winnerIdx]!.name
        const loserTeammates = teams[outcome.loserTeam].filter((s) => !outcome.forfeiters.includes(s))
        changes = await this.d.ratings.applyMatch(
          {
            matchId,
            mode: m.mode,
            teams,
            scoreA: outcome.loserTeam === 0 ? 0 : 1,
            forfeiters: outcome.forfeiters,
            exclude: loserTeammates,
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
      if (outcome.forfeiters.length > 0) {
        await tx
          .update(matchPlayers)
          .set({ abandoned: true })
          .where(and(eq(matchPlayers.matchId, matchId), inArray(matchPlayers.steamId, outcome.forfeiters)))
      }
      await tx
        .update(matches)
        .set({
          status: outcome.forfeiters.length > 0 ? "abandoned" : "cancelled",
          winnerTeam,
          cancelReason: reason,
          endedAt: nowDate,
          ratingApplied: outcome.kind === "forfeit",
        })
        .where(eq(matches.id, matchId))
      const connected = new Map(players.map((p) => [p.steamId, p.everConnected]))
      return { m, outcome, changes, winnerTeam, connected }
    })
    if (!r) return
    for (const id of r.outcome.forfeiters) {
      await this.d.cooldowns.issue(id, r.connected.get(id) ? "abandon" : "no_connect", matchId)
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
    if (r.m.status !== "live") this.sendCancelled(r.m, reason)
    await this.sendMatchUpdate(matchId)
    this.d.events?.emit("match", { event: "match_abandoned", matchId, reason, forfeiters: r.outcome.forfeiters })
    await this.emitResult({ matchId, outcome: "abandoned", reason, missingSteamIds: r.outcome.forfeiters })
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

  async activeMatches(): Promise<MatchRow[]> {
    return this.d.db
      .select()
      .from(matches)
      .where(inArray(matches.status, [...ACTIVE_MATCH_STATUSES]))
      .orderBy(desc(matches.createdAt))
  }

  // Re-sends the live match state to one player, used when a socket connects
  async resendState(steamId: string): Promise<void> {
    const m = await this.activeMatchFor(steamId)
    if (!m) return
    if (m.status === "accepting") {
      const players = await this.players(this.d.db, m.id)
      this.sendMatchFound([steamId], {
        matchId: m.id,
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
          mode: m.mode,
          state: view,
          stepDeadline: row.stepDeadline?.getTime() ?? null,
        }
        toUsers(this.d.notifier, [steamId], "veto_state", payload)
      }
    } else if ((m.status === "ready" || m.status === "live") && m.connect && m.serverIp && m.serverPort) {
      const payload: ServerReadyPayload = {
        matchId: m.id,
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
