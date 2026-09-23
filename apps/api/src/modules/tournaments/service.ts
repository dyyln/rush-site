import {
  type Bracket,
  type BracketMatch,
  type Side,
  buildBracket,
  cancelGame,
  claimGame,
  forfeit,
  isComplete,
  placements,
  playableMatches,
  recordGame,
  releaseGame,
  seedEntries,
  startGame,
} from "./bracket.js"
import { type CupDefinition, nextStart } from "./config.js"
import type {
  BadgeRecord,
  EntryRecord,
  TournamentRecord,
  TournamentStore,
} from "./store.js"
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
  cups: CupDefinition[]
  now: () => Date
  log: Logger
  startMatch(params: StartMatchParams): Promise<{ matchId: string }>
  emit(message: WsMessage<TournamentUpdatePayload>, audience?: EmitAudience): void
  getTrustLevels(steamIds: string[]): Promise<Record<string, TrustLevel>>
  getRatings(steamIds: string[], mode: Mode): Promise<Record<string, number>>
  getParty(steamId: string): Promise<PartyInfo | null>
  getProfiles(steamIds: string[]): Promise<Record<string, ProfileInfo>>
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
    name: profiles[e.captainSteamId]?.displayName ?? e.captainSteamId,
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
    const mine = viewer ? entries.find((e) => e.steamIds.includes(viewer)) : undefined
    return {
      ...this.summary(t, entries.length),
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

  async enter(tournamentId: string, steamId: string): Promise<EntryView> {
    const t = await this.d.store.getTournament(tournamentId)
    if (!t) throw new TournamentError(404, "not_found", "Tournament not found")
    this.assertRegistrationOpen(t)

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
      const entries = await s.listEntries(tournamentId)
      const taken = entries.flatMap((e) => e.steamIds)
      const clash = members.filter((m) => taken.includes(m))
      if (clash.length) {
        throw new TournamentError(409, "already_entered", "Already entered", { steamIds: clash })
      }
      if (entries.length >= fresh.maxEntrants) {
        throw new TournamentError(409, "full", "Tournament is full")
      }
      return s.insertEntry({ tournamentId, captainSteamId: steamId, steamIds: members })
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
      const entry = entries.find((e) => e.steamIds.includes(steamId))
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

  // Creates the next tournament for every cup.
  async ensureUpcoming(): Promise<void> {
    const now = this.d.now()
    for (const cup of this.d.cups) {
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
      let entries = await s.listEntries(tournamentId)
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
    const claims = await this.d.store.locked(tournamentId, async (s) => {
      const t = await s.getTournament(tournamentId)
      const stored = await s.loadBracket(tournamentId)
      if (!t || t.status !== "running" || !stored) return []
      const nowMs = this.d.now().getTime()
      let { bracket } = stored
      const at = { ...stored.provisioningAt }
      let changed = false

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
      const entries = new Map((await s.listEntries(tournamentId)).map((e) => [e.id, e]))
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
    const live = await this.d.store.locked(tournamentId, async (s) => {
      const stored = await s.loadBracket(tournamentId)
      const m = stored?.bracket.matches.find((x) => x.id === c.bracketMatchId)
      if (!stored || !m || m.status !== "provisioning" || stored.provisioningAt[m.id] !== c.claimedAt) {
        if (matchId) {
          this.d.log.error({ tournamentId, match: c.bracketMatchId, matchId }, "claim lost, match left orphaned")
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

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
