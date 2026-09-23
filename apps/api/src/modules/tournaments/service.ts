import {
  type Bracket,
  type BracketMatch,
  type Side,
  buildBracket,
  cancelGame,
  claimGame,
  decide,
  disqualify,
  forfeit,
  isComplete,
  placements,
  playableMatches,
  recordGame,
  releaseGame,
  seedEntries,
  startGame,
} from "./bracket.js"
import { randomUUID } from "node:crypto"
import {
  REGISTRATION_OPENS_HOURS,
  defaultCupName,
  formatFor,
  nextStart,
  scheduleToCup,
} from "./config.js"
import type {
  BadgeRecord,
  EntryRecord,
  NewSchedule,
  ScheduleRecord,
  StoredBracket,
  TournamentRecord,
  TournamentStore,
} from "./store.js"
import type { CupSchedule } from "@rushsite/shared"
import { getModeConfig, tierForRating, trustAtLeast } from "@rushsite/shared"
import { eachLimit } from "../../lib/async.js"
import {
  type BadgeKind,
  type EmitAudience,
  type EntryView,
  type MatchResult,
  type Mode,
  type PartyInfo,
  type ProfileInfo,
  type TournamentDetail,
  type StartMatchParams,
  type TournamentStatus,
  type TournamentSummary,
  type TournamentUpdateKind,
  type TournamentUpdatePayload,
  type TrustLevel,
  type WsMessage,
} from "./types.js"

export const TEAM_NAMES: Record<Side, string> = { a: "A", b: "B" }

export class TournamentError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export interface Logger {
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
}

export interface ServiceDeps {
  store: TournamentStore
  now: () => Date
  log: Logger
  startMatch(params: StartMatchParams): Promise<{ matchId: string }>
  emit(message: WsMessage<TournamentUpdatePayload>, audience?: EmitAudience): void
  getTrustLevels(steamIds: string[]): Promise<Record<string, TrustLevel>>
  getRatings(steamIds: string[], mode: Mode): Promise<Record<string, number>>
  getParty(steamId: string): Promise<PartyInfo | null>
  getProfiles(steamIds: string[]): Promise<Record<string, ProfileInfo>>
  // Stops a CS2 match that no longer counts for the bracket. Optional in tests.
  cancelMatch?(matchId: string, reason: string): Promise<unknown>
}

const DEFAULT_RATING = 1500
export const PROVISION_CONCURRENCY = 4
export const STALE_CLAIM_MS = 5 * 60_000
// Everything else goes to every socket.
const SUBSCRIBER_KINDS = new Set<TournamentUpdateKind>(["match_live", "match_updated", "entries_changed"])

interface PlayerInfo {
  profiles: Record<string, ProfileInfo>
  ratings: Record<string, number>
}

function toEntryView(e: EntryRecord, { profiles, ratings }: PlayerInfo): EntryView {
  const players = e.steamIds.map((steamId) => {
    const rating = ratings[steamId] ?? null
    return {
      steamId,
      displayName: profiles[steamId]?.displayName ?? steamId,
      avatarUrl: profiles[steamId]?.avatarUrl ?? null,
      rating,
      tier: rating === null ? ("unranked" as const) : tierForRating(rating).id,
    }
  })
  return {
    name: e.teamName ?? profiles[e.captainSteamId]?.displayName ?? e.captainSteamId,
    teamName: e.teamName,
    ...(e.disqualifiedAt ? { disqualified: true } : {}),
    players,
    id: e.id,
    captainSteamId: e.captainSteamId,
    steamIds: e.steamIds,
    seed: e.seed,
    rating: e.rating,
    registeredAt: e.createdAt.toISOString(),
  }
}

export class TournamentService {
  constructor(private readonly d: ServiceDeps) {}

  // Views

  summary(t: TournamentRecord, entrantCount: number): TournamentSummary {
    return {
      id: t.id,
      cupKey: t.cupKey,
      name: t.name,
      mode: t.mode,
      cadence: t.cadence,
      status: t.status,
      startsAt: t.startsAt.toISOString(),
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      maxEntrants: t.maxEntrants,
      entrantCount,
      minTrust: t.minTrust,
      entryFee: t.entryFee,
      format: t.format,
      checkIn: false,
      winnerEntryId: t.winnerEntryId,
    }
  }

  async list(
    filter: { status?: TournamentStatus[]; mode?: Mode; limit?: number },
    viewer: string | null = null,
  ): Promise<TournamentSummary[]> {
    const rows = await this.d.store.listTournaments(filter)
    const ids = rows.map((r) => r.id)
    const counts = await this.d.store.countEntries(ids)
    if (!viewer) return rows.map((r) => this.summary(r, counts[r.id] ?? 0))
    const mine = await this.d.store.findPlayerEntries(viewer, ids)
    return rows.map((r) => ({ ...this.summary(r, counts[r.id] ?? 0), myEntryId: mine[r.id] ?? null }))
  }

  async detail(id: string, viewer: string | null): Promise<TournamentDetail> {
    const t = await this.d.store.getTournament(id)
    if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
    const entries = await this.d.store.listEntries(id)
    const stored = await this.d.store.loadBracket(id)
    const profiles = await this.playerInfo(entries.flatMap((e) => e.steamIds), t.mode)
    const mine = viewer ? entries.find((e) => !e.disqualifiedAt && e.steamIds.includes(viewer)) : undefined
    return {
      ...this.summary(t, entries.filter((e) => !e.disqualifiedAt).length),
      entries: entries.map((e) => toEntryView(e, profiles)),
      bracket: stored?.bracket ?? null,
      bracketVersion: t.bracketVersion,
      myEntryId: mine?.id ?? null,
    }
  }

  // Returns only the version when it matches what the client already has.
  async bracket(
    id: string,
    knownVersion: number | null,
  ): Promise<{ version: number; bracket?: Bracket | null }> {
    // Version is read before the bracket so the bracket is never older than the version.
    const t = await this.d.store.getTournament(id)
    if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
    if (knownVersion === t.bracketVersion) return { version: t.bracketVersion }
    const stored = await this.d.store.loadBracket(id)
    return { version: t.bracketVersion, bracket: stored?.bracket ?? null }
  }

  // Sign-up

  async enter(tournamentId: string, steamId: string, teamName?: string): Promise<EntryView> {
    const t = await this.d.store.getTournament(tournamentId)
    if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
    this.assertRegistrationOpen(t)
    if (teamName !== undefined && getModeConfig(t.mode).teamSize === 1) {
      throw new TournamentError(400, "team_name_not_allowed", "Solo cups do not take a team name")
    }

    let members = [steamId]
    if (getModeConfig(t.mode).teamSize > 1) {
      const party = await this.d.getParty(steamId)
      if (!party) throw new TournamentError(400, "party_required", "Enter with a full party")
      if (party.leaderSteamId !== steamId) {
        throw new TournamentError(403, "not_party_leader", "Only the party leader can enter")
      }
      if (party.memberSteamIds.length !== getModeConfig(t.mode).teamSize) {
        throw new TournamentError(
          400,
          "party_size",
          `This cup needs a party of ${getModeConfig(t.mode).teamSize}`,
        )
      }
      members = [...new Set(party.memberSteamIds)]
    }

    const failing = await this.untrusted(members, t.minTrust)
    if (failing.length) {
      throw new TournamentError(403, "trust_required", `${t.minTrust} trust level required`, {
        steamIds: failing,
      })
    }

    const entry = await this.d.store.locked(tournamentId, async (s) => {
      const fresh = await s.getTournament(tournamentId)
      if (!fresh) throw new TournamentError(404, "not_found", "Tournament not found")
      this.assertRegistrationOpen(fresh)
      const all = await s.listEntries(tournamentId)
      const banned = all.filter((e) => e.disqualifiedAt).flatMap((e) => e.steamIds)
      const dq = members.filter((m) => banned.includes(m))
      if (dq.length) {
        throw new TournamentError(403, "disqualified", "Disqualified from this cup", { steamIds: dq })
      }
      const entries = all.filter((e) => !e.disqualifiedAt)
      const taken = entries.flatMap((e) => e.steamIds)
      const clash = members.filter((m) => taken.includes(m))
      if (clash.length) {
        throw new TournamentError(409, "already_entered", "Already entered", { steamIds: clash })
      }
      if (entries.length >= fresh.maxEntrants) {
        throw new TournamentError(409, "full", "Tournament is full")
      }
      const wanted = teamName?.toLowerCase()
      if (wanted && entries.some((e) => e.teamName?.toLowerCase() === wanted)) {
        throw new TournamentError(409, "team_name_taken", "Another team in this cup has that name")
      }
      return s.insertEntry({ tournamentId, captainSteamId: steamId, steamIds: members, teamName: teamName ?? null })
    })
    await this.announce(tournamentId, "entries_changed")
    return toEntryView(entry, await this.playerInfo(entry.steamIds, t.mode))
  }

  async withdraw(tournamentId: string, steamId: string): Promise<void> {
    await this.d.store.locked(tournamentId, async (s) => {
      const t = await s.getTournament(tournamentId)
      if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
      if (t.status !== "open") {
        throw new TournamentError(409, "registration_closed", "Tournament has already started")
      }
      const entries = await s.listEntries(tournamentId)
      const entry = entries.find((e) => !e.disqualifiedAt && e.steamIds.includes(steamId))
      if (!entry) throw new TournamentError(404, "not_entered", "Not entered")
      await s.deleteEntries([entry.id])
    })
    await this.announce(tournamentId, "entries_changed")
  }

  private assertRegistrationOpen(t: TournamentRecord) {
    const now = this.d.now()
    if (t.status !== "open" || now >= t.startsAt) {
      throw new TournamentError(409, "registration_closed", "Registration is closed")
    }
    if (now < t.registrationOpensAt) {
      throw new TournamentError(409, "registration_not_open", "Registration is not open yet")
    }
  }

  // Display only. A failed lookup falls back to SteamIDs and unranked.
  private async playerInfo(steamIds: string[], mode: Mode): Promise<PlayerInfo> {
    if (steamIds.length === 0) return { profiles: {}, ratings: {} }
    const safe = <T>(p: Promise<Record<string, T>>, what: string) =>
      p.catch((err) => {
        this.d.log.warn({ err }, `${what} lookup failed`)
        return {} as Record<string, T>
      })
    const [profiles, ratings] = await Promise.all([
      safe(this.d.getProfiles(steamIds), "profile"),
      safe(this.d.getRatings(steamIds, mode), "rating"),
    ])
    return { profiles, ratings }
  }

  private async untrusted(steamIds: string[], min: TrustLevel): Promise<string[]> {
    const levels = await this.d.getTrustLevels(steamIds)
    return steamIds.filter((id) => {
      const lvl = levels[id]
      return !lvl || !trustAtLeast(lvl, min)
    })
  }

  // Scheduler

  private ticking = false

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await this.ensureUpcoming()
      await this.startDue()
      const running = await this.d.store.listTournaments({ status: ["running"] })
      for (const t of running) await this.provision(t.id)
    } finally {
      this.ticking = false
    }
  }

  // Creates the next tournament for every enabled schedule that has no open one.
  async ensureUpcoming(): Promise<void> {
    const now = this.d.now()
    const schedules = (await this.d.store.listSchedules()).filter((x) => x.enabled)
    if (schedules.length === 0) return
    const open = await this.d.store.listTournaments({ status: ["open"], limit: 1000 })
    const waiting = new Set(open.map((t) => t.cupKey))
    for (const cup of schedules.map(scheduleToCup)) {
      if (waiting.has(cup.key)) continue
      const startsAt = nextStart(cup, now)
      const created = await this.d.store.createTournament({
        cupKey: cup.key,
        name: cup.name,
        mode: cup.mode,
        cadence: cup.cadence,
        maxEntrants: cup.maxEntrants,
        minTrust: cup.minTrust,
        entryFee: cup.entryFee,
        format: cup.format,
        registrationOpensAt: new Date(startsAt.getTime() - cup.registrationOpensHours * 3600_000),
        startsAt,
      })
      if (!created) continue
      this.d.log.info({ cup: cup.key, startsAt }, "tournament created")
      await this.announce(created, "created")
    }
  }

  async startDue(): Promise<void> {
    const due = await this.d.store.listTournaments({
      status: ["open"],
      startsBefore: this.d.now(),
    })
    for (const t of due) {
      try {
        await this.start(t.id)
      } catch (err) {
        this.d.log.error({ err, tournamentId: t.id }, "tournament start failed")
      }
    }
  }

  async start(tournamentId: string): Promise<void> {
    const outcome = await this.d.store.locked(tournamentId, async (s) => {
      const t = await s.getTournament(tournamentId)
      if (!t || t.status !== "open") return null
      const now = this.d.now()

      // Entries whose members lost the required trust since sign-up are dropped.
      let entries = (await s.listEntries(tournamentId)).filter((e) => !e.disqualifiedAt)
      const all = entries.flatMap((e) => e.steamIds)
      const failing = new Set(await this.untrusted(all, t.minTrust))
      const dropped = entries.filter((e) => e.steamIds.some((id) => failing.has(id)))
      if (dropped.length) {
        await s.deleteEntries(dropped.map((e) => e.id))
        entries = entries.filter((e) => !dropped.includes(e))
      }

      if (entries.length < 2) {
        await s.updateTournament(tournamentId, {
          status: "cancelled",
          cancelReason: "not_enough_entrants",
          completedAt: now,
        })
        return "cancelled" as const
      }

      const ratings = await this.d.getRatings(all, t.mode)
      const seedInput = entries.map((e) => ({
        id: e.id,
        rating: mean(e.steamIds.map((id) => ratings[id] ?? DEFAULT_RATING)),
        registeredAt: e.createdAt.getTime(),
      }))
      const seeded = seedEntries(seedInput)
      await s.updateEntrySeeds(seeded.map((e, i) => ({ id: e.id, seed: i + 1, rating: e.rating })))
      const bracket = buildBracket(seedInput, t.format.bestOf)
      await s.saveBracket(tournamentId, { bracket, provisionAttempts: {}, provisioningAt: {} })
      await s.updateTournament(tournamentId, { status: "running", startedAt: now })
      return "started" as const
    })
    if (!outcome) return
    await this.announce(tournamentId, outcome)
    if (outcome === "started") await this.provision(tournamentId)
  }

  // Claims every bracket match waiting on its next game under the row lock, then
  // requests servers after commit so slow allocation never holds the lock.
  async provision(tournamentId: string): Promise<void> {
    let completed = false
    const claims = await this.d.store.locked(tournamentId, async (s) => {
      const t = await s.getTournament(tournamentId)
      const stored = await s.loadBracket(tournamentId)
      if (!t || t.status !== "running" || !stored) return []
      const nowMs = this.d.now().getTime()
      const entries = new Map((await s.listEntries(tournamentId)).map((e) => [e.id, e]))
      let bracket = sweepDisqualified(stored.bracket, entries)
      let changed = bracket !== stored.bracket
      if (isComplete(bracket)) {
        await s.saveBracket(tournamentId, { ...stored, bracket })
        await this.complete(s, t, bracket)
        completed = true
        return []
      }
      const at = { ...stored.provisioningAt }

      // A claim this old belongs to a process that died mid request.
      for (const m of bracket.matches) {
        if (m.status !== "provisioning") continue
        if (nowMs - (at[m.id] ?? 0) < STALE_CLAIM_MS) continue
        this.d.log.warn({ tournamentId, match: m.id }, "releasing stale provisioning claim")
        bracket = releaseGame(bracket, m.id)
        delete at[m.id]
        changed = true
      }

      const ready = playableMatches(bracket)
      const out: Claim[] = []
      for (const m of ready) {
        const a = entries.get(m.a as string)
        const b = entries.get(m.b as string)
        if (!a || !b) {
          this.d.log.error({ tournamentId, match: m.id }, "bracket entry missing")
          continue
        }
        bracket = claimGame(bracket, m.id)
        at[m.id] = nowMs
        changed = true
        out.push({
          bracketMatchId: m.id,
          claimedAt: nowMs,
          params: {
            mode: t.mode,
            teams: [
              { name: TEAM_NAMES.a, steamIds: a.steamIds },
              { name: TEAM_NAMES.b, steamIds: b.steamIds },
            ],
            source: {
              kind: "tournament",
              tournamentId,
              bracketMatchId: m.id,
              gameNumber: m.games.length + 1,
              bestOf: m.bestOf,
            },
          },
        })
      }
      if (changed) await s.saveBracket(tournamentId, { ...stored, bracket, provisioningAt: at })
      return out
    })
    if (completed) {
      await this.announce(tournamentId, "completed")
      return
    }
    await eachLimit(claims, PROVISION_CONCURRENCY, (c) => this.startClaim(tournamentId, c))
  }

  private async startClaim(tournamentId: string, c: Claim): Promise<void> {
    let matchId: string | null = null
    try {
      matchId = (await this.d.startMatch(c.params)).matchId
    } catch (err) {
      this.d.log.warn(
        { err, tournamentId, match: c.bracketMatchId },
        "tournament match provisioning failed, retrying next tick",
      )
    }
    let orphan: string | null = null
    const live = await this.d.store.locked(tournamentId, async (s) => {
      const stored = await s.loadBracket(tournamentId)
      const m = stored?.bracket.matches.find((x) => x.id === c.bracketMatchId)
      if (!stored || !m || m.status !== "provisioning" || stored.provisioningAt[m.id] !== c.claimedAt) {
        if (matchId) {
          this.d.log.warn({ tournamentId, match: c.bracketMatchId, matchId }, "claim lost, cancelling the new match")
          orphan = matchId
        }
        return false
      }
      const provisioningAt = { ...stored.provisioningAt }
      delete provisioningAt[m.id]
      const attempts = { ...stored.provisionAttempts }
      let bracket: Bracket
      if (matchId) {
        bracket = startGame(stored.bracket, m.id, matchId)
        attempts[m.id] = 0
      } else {
        bracket = releaseGame(stored.bracket, m.id)
        attempts[m.id] = (attempts[m.id] ?? 0) + 1
      }
      await s.saveBracket(tournamentId, { bracket, provisionAttempts: attempts, provisioningAt })
      return matchId !== null
    })
    if (orphan) await this.stopMatches([orphan], "tournament_match_resolved")
    if (live) await this.announce(tournamentId, "match_live", c.bracketMatchId)
  }

  // Results

  async handleResult(result: MatchResult): Promise<void> {
    const tournamentId = await this.d.store.findTournamentByLiveMatch(result.matchId)
    if (!tournamentId) return

    const changed = await this.d.store.locked(tournamentId, async (s) => {
      const stored = await s.loadBracket(tournamentId)
      const t = await s.getTournament(tournamentId)
      if (!stored || !t || t.status !== "running") return null
      const m = stored.bracket.matches.find((x) => x.liveMatchId === result.matchId)
      if (!m) return null
      const bracket = await this.applyResult(s, tournamentId, stored.bracket, m, result)
      await s.saveBracket(tournamentId, { ...stored, bracket })
      const complete = isComplete(bracket)
      if (complete) await this.complete(s, t, bracket)
      return { matchId: m.id, complete }
    })
    if (!changed) return
    await this.announce(tournamentId, "match_updated", changed.matchId)
    if (changed.complete) await this.announce(tournamentId, "completed")
    else await this.provision(tournamentId)
  }

  private async applyResult(
    s: TournamentStore,
    tournamentId: string,
    bracket: Bracket,
    m: BracketMatch,
    result: MatchResult,
  ): Promise<Bracket> {
    if (result.outcome === "completed") {
      const side = (Object.keys(TEAM_NAMES) as Side[]).find(
        (k) => TEAM_NAMES[k] === result.winnerTeam,
      )
      if (!side) {
        this.d.log.error({ tournamentId, result }, "unknown winner team, replaying game")
        return cancelGame(bracket, m.id, result.matchId)
      }
      return recordGame(bracket, m.id, result.matchId, side)
    }
    if (result.outcome === "abandoned") {
      const entries = await s.listEntries(tournamentId)
      const missing = new Set(result.missingSteamIds)
      const absent = (entryId: string | null) =>
        entries.find((e) => e.id === entryId)?.steamIds.some((id) => missing.has(id)) ?? false
      const losers: Side[] = []
      if (absent(m.a)) losers.push("a")
      if (absent(m.b)) losers.push("b")
      if (losers.length) return forfeit(bracket, m.id, losers)
      this.d.log.warn({ tournamentId, result }, "abandoned with nobody missing, replaying game")
      return cancelGame(bracket, m.id, result.matchId)
    }
    return cancelGame(bracket, m.id, result.matchId)
  }

  private async complete(s: TournamentStore, t: TournamentRecord, bracket: Bracket) {
    const p = placements(bracket)
    const entries = new Map((await s.listEntries(t.id)).map((e) => [e.id, e]))
    const rows: BadgeRecord[] = []
    const add = (entryId: string | null, kind: BadgeKind, label: string) => {
      const e = entryId ? entries.get(entryId) : undefined
      if (!e) return
      for (const steamId of e.steamIds) {
        rows.push({ steamId, kind, tournamentId: t.id, mode: t.mode, label: `${label} ${t.name}` })
      }
    }
    add(p.champion, "cup_champion", "Winner")
    add(p.runnerUp, "cup_runner_up", "Runner-up")
    for (const id of p.semifinalists) add(id, "cup_semifinalist", "Semifinalist")
    await s.insertBadges(rows)
    await s.updateTournament(t.id, {
      status: "completed",
      completedAt: this.d.now(),
      winnerEntryId: p.champion,
    })
  }

  // Admin: schedules

  scheduleView(x: ScheduleRecord): CupSchedule {
    return {
      id: x.id,
      cupKey: x.cupKey,
      name: x.name,
      mode: x.mode,
      cadence: x.cadence,
      weekday: x.cadence === "weekly" ? x.weekday : null,
      startTime: x.startTime,
      maxEntrants: x.maxEntrants,
      minTrust: x.minTrust,
      bestOfFinal: x.bestOfFinal as CupSchedule["bestOfFinal"],
      enabled: x.enabled,
      nextStartsAt: x.enabled ? nextStart(scheduleToCup(x), this.d.now()).toISOString() : null,
      updatedAt: x.updatedAt.toISOString(),
    }
  }

  async listSchedules(): Promise<CupSchedule[]> {
    return (await this.d.store.listSchedules()).map((x) => this.scheduleView(x))
  }

  async createSchedule(input: Omit<NewSchedule, "cupKey" | "name"> & { name?: string }): Promise<CupSchedule> {
    const row = await this.d.store.insertSchedule({
      ...input,
      weekday: input.cadence === "weekly" ? input.weekday : null,
      name: input.name ?? defaultCupName(input.mode, input.cadence),
      cupKey: `${input.cadence}-${input.mode}-${randomUUID().slice(0, 8)}`,
    })
    await this.ensureUpcoming()
    return this.scheduleView(row)
  }

  // Changes carry over to the schedule's open cup. A new time moves that cup to the next slot.
  async updateSchedule(id: string, patch: Partial<Omit<NewSchedule, "cupKey">>): Promise<CupSchedule> {
    const before = await this.d.store.getSchedule(id)
    if (!before) throw new TournamentError(404, "not_found", "Schedule not found")
    const merged = { ...before, ...patch }
    if (merged.cadence === "weekly" && (merged.weekday === null || merged.weekday === undefined)) {
      throw new TournamentError(400, "invalid_request", "Weekly schedules need a weekday")
    }
    if (merged.cadence === "daily") merged.weekday = null

    const open = (await this.d.store.listTournaments({ status: ["open"], limit: 1000 })).filter(
      (t) => t.cupKey === before.cupKey,
    )
    const counts = await this.d.store.countEntries(open.map((t) => t.id))
    if (merged.mode !== before.mode && open.some((t) => (counts[t.id] ?? 0) > 0)) {
      throw new TournamentError(409, "schedule_has_entries", "The open cup has entries. Cancel it before changing the mode")
    }

    const { id: _id, updatedAt: _u, ...fields } = merged
    const row = await this.d.store.updateSchedule(id, fields)
    if (!row) throw new TournamentError(404, "not_found", "Schedule not found")

    const cup = scheduleToCup(row)
    const timing =
      row.cadence !== before.cadence || row.weekday !== before.weekday || row.startTime !== before.startTime
    const now = this.d.now()
    for (const t of open) {
      const startsAt = timing ? nextStart(cup, now) : t.startsAt
      const opens = new Date(startsAt.getTime() - cup.registrationOpensHours * 3600_000)
      await this.d.store.locked(t.id, async (s) => {
        const fresh = await s.getTournament(t.id)
        if (!fresh || fresh.status !== "open") return
        await s.updateTournament(t.id, {
          name: row.name,
          mode: row.mode,
          maxEntrants: row.maxEntrants,
          minTrust: row.minTrust,
          format: cup.format,
          startsAt,
          registrationOpensAt: timing ? (opens < fresh.registrationOpensAt ? opens : fresh.registrationOpensAt) : fresh.registrationOpensAt,
        })
      })
      await this.announce(t.id, timing ? "rescheduled" : "entries_changed")
    }
    if (row.enabled) await this.ensureUpcoming()
    return this.scheduleView(row)
  }

  // Open cups the schedule already created stay. Cancel them on their own.
  async deleteSchedule(id: string): Promise<ScheduleRecord> {
    const row = await this.d.store.getSchedule(id)
    if (!row || !(await this.d.store.deleteSchedule(id))) {
      throw new TournamentError(404, "not_found", "Schedule not found")
    }
    return row
  }

  // Admin: cups

  async createCup(input: {
    mode: Mode
    name: string
    startsAt: Date
    maxEntrants: number
    minTrust: TrustLevel
    bestOfFinal: number
  }): Promise<TournamentSummary> {
    const now = this.d.now()
    if (input.startsAt.getTime() <= now.getTime() + 60_000) {
      throw new TournamentError(400, "invalid_request", "startsAt must be at least a minute in the future")
    }
    const id = await this.d.store.createTournament({
      cupKey: `special-${randomUUID()}`,
      name: input.name,
      mode: input.mode,
      cadence: "special",
      maxEntrants: input.maxEntrants,
      minTrust: input.minTrust,
      entryFee: 0,
      format: formatFor(input.bestOfFinal),
      registrationOpensAt: now,
      startsAt: input.startsAt,
    })
    if (!id) throw new Error("one-off cup insert returned no id")
    await this.announce(id, "created")
    return this.summaryOf(id)
  }

  async cancel(tournamentId: string): Promise<TournamentSummary> {
    const live = await this.d.store.locked(tournamentId, async (s) => {
      const t = await s.getTournament(tournamentId)
      if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
      if (t.status !== "open" && t.status !== "running") {
        throw new TournamentError(409, "tournament_over", `Tournament is already ${t.status}`)
      }
      const stored = await s.loadBracket(tournamentId)
      await s.updateTournament(tournamentId, {
        status: "cancelled",
        cancelReason: "admin_cancelled",
        completedAt: this.d.now(),
      })
      return liveMatchIds(stored)
    })
    await this.stopMatches(live, "tournament_cancelled")
    await this.announce(tournamentId, "cancelled")
    return this.summaryOf(tournamentId)
  }

  async reschedule(tournamentId: string, startsAt: Date): Promise<{ before: string; tournament: TournamentSummary }> {
    const now = this.d.now()
    if (startsAt.getTime() <= now.getTime() + 60_000) {
      throw new TournamentError(400, "invalid_request", "startsAt must be at least a minute in the future")
    }
    const before = await this.d.store.locked(tournamentId, async (s) => {
      const t = await s.getTournament(tournamentId)
      if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
      if (t.status !== "open") throw new TournamentError(409, "already_started", "Only open cups can be rescheduled")
      try {
        await s.updateTournament(tournamentId, {
          startsAt,
          registrationOpensAt: t.registrationOpensAt < startsAt ? t.registrationOpensAt : now,
        })
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new TournamentError(409, "slot_taken", "This cup already has a tournament at that time")
        }
        throw err
      }
      return t.startsAt.toISOString()
    })
    await this.announce(tournamentId, "rescheduled")
    return { before, tournament: await this.summaryOf(tournamentId) }
  }

  // Open cups keep the entry but block it. Running cups also knock it out of its current series.
  async disqualify(tournamentId: string, entryId: string, reason: string): Promise<EntryRecord> {
    const out = await this.d.store.locked(tournamentId, async (s) => {
      const t = await s.getTournament(tournamentId)
      if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
      if (t.status !== "open" && t.status !== "running") {
        throw new TournamentError(409, "tournament_over", `Tournament is already ${t.status}`)
      }
      const entry = (await s.listEntries(tournamentId)).find((e) => e.id === entryId)
      if (!entry) throw new TournamentError(404, "not_found", "Entry not found")
      if (entry.disqualifiedAt) throw new TournamentError(409, "already_disqualified", "Entry is already disqualified")
      await s.disqualifyEntry(entryId, reason, this.d.now())
      if (t.status === "open") return { entry, stop: [] as string[], matchId: undefined, complete: false }

      const stored = await s.loadBracket(tournamentId)
      if (!stored) return { entry, stop: [], matchId: undefined, complete: false }
      const m = stored.bracket.matches.find(
        (x) => (x.a === entryId || x.b === entryId) && ["ready", "provisioning", "live"].includes(x.status),
      )
      if (!m) return { entry, stop: [], matchId: undefined, complete: false }
      const bracket = disqualify(stored.bracket, m.id, m.a === entryId ? "a" : "b")
      return this.saveAdminBracket(s, t, stored, bracket, m, entry)
    })
    await this.afterAdminBracket(tournamentId, out.stop, out.matchId, out.complete, "disqualified")
    return out.entry
  }

  async forceResult(tournamentId: string, bracketMatchId: string, winnerEntryId: string): Promise<{ loserEntryId: string | null }> {
    const out = await this.d.store.locked(tournamentId, async (s) => {
      const t = await s.getTournament(tournamentId)
      if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
      if (t.status !== "running") throw new TournamentError(409, "not_running", "Tournament is not running")
      const stored = await s.loadBracket(tournamentId)
      const m = stored?.bracket.matches.find((x) => x.id === bracketMatchId)
      if (!stored || !m) throw new TournamentError(404, "not_found", "Bracket match not found")
      if (!["ready", "provisioning", "live"].includes(m.status)) {
        throw new TournamentError(409, "match_not_open", `Bracket match is ${m.status}`)
      }
      if (winnerEntryId !== m.a && winnerEntryId !== m.b) {
        throw new TournamentError(400, "not_in_match", "Winner must be one of the two entries in the match")
      }
      const loser = winnerEntryId === m.a ? m.b : m.a
      const bracket = decide(stored.bracket, m.id, winnerEntryId === m.a ? "a" : "b")
      return { ...(await this.saveAdminBracket(s, t, stored, bracket, m, null)), loser }
    })
    await this.afterAdminBracket(tournamentId, out.stop, out.matchId, out.complete, "admin_forced_result")
    return { loserEntryId: out.loser }
  }

  private async saveAdminBracket<E>(
    s: TournamentStore,
    t: TournamentRecord,
    stored: StoredBracket,
    bracket: Bracket,
    m: BracketMatch,
    entry: E,
  ) {
    const provisioningAt = { ...stored.provisioningAt }
    delete provisioningAt[m.id]
    await s.saveBracket(t.id, { ...stored, bracket, provisioningAt })
    const complete = isComplete(bracket)
    if (complete) await this.complete(s, t, bracket)
    return { entry, stop: m.liveMatchId ? [m.liveMatchId] : [], matchId: m.id as string | undefined, complete }
  }

  private async afterAdminBracket(
    tournamentId: string,
    stop: string[],
    matchId: string | undefined,
    complete: boolean,
    reason: string,
  ) {
    await this.stopMatches(stop, reason)
    if (matchId) await this.announce(tournamentId, "match_updated", matchId)
    else await this.announce(tournamentId, "entries_changed")
    if (complete) await this.announce(tournamentId, "completed")
    else await this.provision(tournamentId)
  }

  private async stopMatches(matchIds: string[], reason: string) {
    if (!this.d.cancelMatch) return
    for (const id of matchIds) {
      try {
        await this.d.cancelMatch(id, reason)
      } catch (err) {
        this.d.log.warn({ err, matchId: id }, "could not cancel tournament match")
      }
    }
  }

  async summaryOf(tournamentId: string): Promise<TournamentSummary> {
    const t = await this.d.store.getTournament(tournamentId)
    if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
    const counts = await this.d.store.countEntries([tournamentId])
    return this.summary(t, counts[tournamentId] ?? 0)
  }

  // Events

  private async announce(tournamentId: string, kind: TournamentUpdateKind, bracketMatchId?: string) {
    try {
      const t = await this.d.store.getTournament(tournamentId)
      if (!t) return
      const counts = await this.d.store.countEntries([tournamentId])
      const payload: TournamentUpdatePayload = {
        kind,
        tournament: this.summary(t, counts[tournamentId] ?? 0),
        bracketVersion: t.bracketVersion,
      }
      if (bracketMatchId) payload.bracketMatchId = bracketMatchId
      const audience: EmitAudience = SUBSCRIBER_KINDS.has(kind)
        ? { kind: "tournament", tournamentId }
        : { kind: "broadcast" }
      this.d.emit({ type: "tournament_update", payload, ts: Date.now() }, audience)
    } catch (err) {
      this.d.log.error({ err, tournamentId, kind }, "tournament_update emit failed")
    }
  }
}

interface Claim {
  bracketMatchId: string
  claimedAt: number
  params: StartMatchParams
}

function liveMatchIds(stored: StoredBracket | null): string[] {
  if (!stored) return []
  return stored.bracket.matches.flatMap((m) => (m.status === "live" && m.liveMatchId ? [m.liveMatchId] : []))
}

// Ready series with a disqualified side are settled before anything is provisioned.
function sweepDisqualified(input: Bracket, entries: Map<string, EntryRecord>): Bracket {
  const out = (id: string | null) => (id ? !!entries.get(id)?.disqualifiedAt : false)
  let bracket = input
  for (;;) {
    const m = playableMatches(bracket).find((x) => out(x.a) || out(x.b))
    if (!m) return bracket
    bracket =
      out(m.a) && out(m.b)
        ? forfeit(bracket, m.id, ["a", "b"])
        : disqualify(bracket, m.id, out(m.a) ? "a" : "b")
  }
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
