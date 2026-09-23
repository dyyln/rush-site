import { and, arrayContains, asc, count, eq, inArray, isNull, lte, sql } from "drizzle-orm"
import type { Bracket, BracketMatch, Resolution } from "./bracket.js"
import type { CupFormat } from "./config.js"
import { adminAudit } from "../admin/schema.js"
import { badges, bracketMatches, brackets, cupSchedules, tournamentEntries, tournaments } from "./schema.js"
import type { BadgeKind, CupCadence, Db, Mode, TournamentStatus, TrustLevel } from "./types.js"

export interface TournamentRecord {
  id: string
  cupKey: string
  name: string
  mode: Mode
  cadence: CupCadence
  status: TournamentStatus
  maxEntrants: number
  minTrust: TrustLevel
  entryFee: number
  format: CupFormat
  registrationOpensAt: Date
  startsAt: Date
  startedAt: Date | null
  completedAt: Date | null
  cancelReason: string | null
  winnerEntryId: string | null
  bracketVersion: number
}

export type NewTournament = Omit<
  TournamentRecord,
  "id" | "status" | "startedAt" | "completedAt" | "cancelReason" | "winnerEntryId" | "bracketVersion"
>

export interface EntryRecord {
  id: string
  tournamentId: string
  captainSteamId: string
  steamIds: string[]
  seed: number | null
  rating: number | null
  teamName: string | null
  disqualifiedAt: Date | null
  disqualifyReason: string | null
  createdAt: Date
}

export type NewEntry = Pick<EntryRecord, "tournamentId" | "captainSteamId" | "steamIds"> & {
  teamName?: string | null
}

export interface ScheduleRecord {
  id: string
  cupKey: string
  name: string
  mode: Mode
  cadence: "daily" | "weekly"
  // 0 is Sunday. Only used by weekly schedules.
  weekday: number | null
  // UTC as HH:MM
  startTime: string
  maxEntrants: number
  minTrust: TrustLevel
  bestOfFinal: number
  enabled: boolean
  updatedAt: Date
}

export type NewSchedule = Omit<ScheduleRecord, "id" | "updatedAt">

export interface AuditRow {
  adminSteamId: string
  action: string
  target: string
  payload: unknown
}

export interface BadgeRecord {
  steamId: string
  kind: BadgeKind
  tournamentId: string
  mode: Mode
  label: string
}

export interface StoredBracket {
  bracket: Bracket
  provisionAttempts: Record<string, number>
  // Epoch ms when each provisioning match was claimed.
  provisioningAt: Record<string, number>
}

export interface TournamentFilter {
  status?: TournamentStatus[]
  mode?: Mode
  startsBefore?: Date
  limit?: number
}

export interface TournamentStore {
  // Returns the new id, or null when the cup already has a tournament at that start time.
  createTournament(t: NewTournament): Promise<string | null>
  getTournament(id: string): Promise<TournamentRecord | null>
  listTournaments(f: TournamentFilter): Promise<TournamentRecord[]>
  updateTournament(id: string, patch: Partial<TournamentRecord>): Promise<void>
  // Includes disqualified entries.
  listEntries(tournamentId: string): Promise<EntryRecord[]>
  // Leaves out disqualified entries.
  countEntries(tournamentIds: string[]): Promise<Record<string, number>>
  // Entry id per tournament for one player. Disqualified entries are left out.
  findPlayerEntries(steamId: string, tournamentIds: string[]): Promise<Record<string, string>>
  insertEntry(e: NewEntry): Promise<EntryRecord>
  disqualifyEntry(id: string, reason: string, at: Date): Promise<void>
  deleteEntries(ids: string[]): Promise<void>
  updateEntrySeeds(rows: { id: string; seed: number; rating: number }[]): Promise<void>
  // Also bumps the tournament's bracket version and returns the new one.
  saveBracket(tournamentId: string, stored: StoredBracket): Promise<number>
  loadBracket(tournamentId: string): Promise<StoredBracket | null>
  findTournamentByLiveMatch(matchId: string): Promise<string | null>
  insertBadges(rows: BadgeRecord[]): Promise<void>
  // Returns how many badges were removed.
  deleteBadges(tournamentId: string, steamIds: string[]): Promise<number>
  listSchedules(): Promise<ScheduleRecord[]>
  getSchedule(id: string): Promise<ScheduleRecord | null>
  insertSchedule(s: NewSchedule): Promise<ScheduleRecord>
  updateSchedule(id: string, patch: Partial<NewSchedule>): Promise<ScheduleRecord | null>
  deleteSchedule(id: string): Promise<boolean>
  writeAudit(row: AuditRow): Promise<void>
  // Runs fn with the tournament row locked. Do not nest.
  locked<T>(tournamentId: string, fn: (store: TournamentStore) => Promise<T>): Promise<T>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID_RE.test(s)

type TRow = typeof tournaments.$inferSelect
type ERow = typeof tournamentEntries.$inferSelect
type MRow = typeof bracketMatches.$inferSelect
type SRow = typeof cupSchedules.$inferSelect

function toSchedule(r: SRow): ScheduleRecord {
  return {
    id: r.id,
    cupKey: r.cupKey,
    name: r.name,
    mode: r.mode as Mode,
    cadence: r.cadence as ScheduleRecord["cadence"],
    weekday: r.weekday,
    startTime: r.startTime.slice(0, 5),
    maxEntrants: r.maxEntrants,
    minTrust: r.minTrust as TrustLevel,
    bestOfFinal: r.bestOfFinal,
    enabled: r.enabled,
    updatedAt: r.updatedAt,
  }
}

function toTournament(r: TRow): TournamentRecord {
  return {
    id: r.id,
    cupKey: r.cupKey,
    name: r.name,
    mode: r.mode as Mode,
    cadence: r.cadence as CupCadence,
    status: r.status as TournamentStatus,
    maxEntrants: r.maxEntrants,
    minTrust: r.minTrust as TrustLevel,
    entryFee: r.entryFee,
    format: r.format as CupFormat,
    registrationOpensAt: r.registrationOpensAt,
    startsAt: r.startsAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    cancelReason: r.cancelReason,
    winnerEntryId: r.winnerEntryId,
    bracketVersion: r.bracketVersion,
  }
}

function toEntry(r: ERow): EntryRecord {
  return {
    id: r.id,
    tournamentId: r.tournamentId,
    captainSteamId: r.captainSteamId,
    steamIds: r.steamIds,
    seed: r.seed,
    rating: r.rating,
    teamName: r.teamName,
    disqualifiedAt: r.disqualifiedAt,
    disqualifyReason: r.disqualifyReason,
    createdAt: r.createdAt,
  }
}

function toMatch(r: MRow): BracketMatch {
  return {
    id: r.key,
    round: r.round,
    index: r.index,
    bestOf: r.bestOf,
    a: r.entryA,
    b: r.entryB,
    aSeed: r.seedA,
    bSeed: r.seedB,
    aResolved: r.aResolved,
    bResolved: r.bResolved,
    status: r.status as BracketMatch["status"],
    games: r.games,
    liveMatchId: r.liveMatchId,
    winner: r.winnerEntryId,
    resolution: r.resolution as Resolution | null,
  }
}

export class DrizzleTournamentStore implements TournamentStore {
  constructor(private readonly db: Db) {}

  async createTournament(t: NewTournament): Promise<string | null> {
    const rows = await this.db
      .insert(tournaments)
      .values({ ...t, status: "open" })
      .onConflictDoNothing({ target: [tournaments.cupKey, tournaments.startsAt] })
      .returning({ id: tournaments.id })
    return rows[0]?.id ?? null
  }

  async getTournament(id: string): Promise<TournamentRecord | null> {
    if (!isUuid(id)) return null
    const [row] = await this.db.select().from(tournaments).where(eq(tournaments.id, id))
    return row ? toTournament(row) : null
  }

  async listTournaments(f: TournamentFilter): Promise<TournamentRecord[]> {
    const conds = []
    if (f.status?.length) conds.push(inArray(tournaments.status, f.status))
    if (f.mode) conds.push(eq(tournaments.mode, f.mode))
    if (f.startsBefore) conds.push(lte(tournaments.startsAt, f.startsBefore))
    const rows = await this.db
      .select()
      .from(tournaments)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(tournaments.startsAt))
      .limit(f.limit ?? 100)
    return rows.map(toTournament)
  }

  async updateTournament(id: string, patch: Partial<TournamentRecord>): Promise<void> {
    const { id: _ignored, ...rest } = patch
    if (Object.keys(rest).length === 0) return
    await this.db.update(tournaments).set(rest).where(eq(tournaments.id, id))
  }

  async listEntries(tournamentId: string): Promise<EntryRecord[]> {
    const rows = await this.db
      .select()
      .from(tournamentEntries)
      .where(eq(tournamentEntries.tournamentId, tournamentId))
      .orderBy(asc(tournamentEntries.createdAt))
    return rows.map(toEntry)
  }

  async countEntries(tournamentIds: string[]): Promise<Record<string, number>> {
    if (tournamentIds.length === 0) return {}
    const rows = await this.db
      .select({ id: tournamentEntries.tournamentId, n: count() })
      .from(tournamentEntries)
      .where(and(inArray(tournamentEntries.tournamentId, tournamentIds), isNull(tournamentEntries.disqualifiedAt)))
      .groupBy(tournamentEntries.tournamentId)
    return Object.fromEntries(rows.map((r) => [r.id, Number(r.n)]))
  }

  async findPlayerEntries(
    steamId: string,
    tournamentIds: string[],
  ): Promise<Record<string, string>> {
    if (tournamentIds.length === 0) return {}
    const rows = await this.db
      .select({ id: tournamentEntries.id, tournamentId: tournamentEntries.tournamentId })
      .from(tournamentEntries)
      .where(
        and(
          inArray(tournamentEntries.tournamentId, tournamentIds),
          arrayContains(tournamentEntries.steamIds, [steamId]),
          isNull(tournamentEntries.disqualifiedAt),
        ),
      )
    return Object.fromEntries(rows.map((r) => [r.tournamentId, r.id]))
  }

  async insertEntry(e: NewEntry): Promise<EntryRecord> {
    const [row] = await this.db.insert(tournamentEntries).values(e).returning()
    if (!row) throw new Error("entry insert returned no row")
    return toEntry(row)
  }

  async disqualifyEntry(id: string, reason: string, at: Date): Promise<void> {
    await this.db
      .update(tournamentEntries)
      .set({ disqualifiedAt: at, disqualifyReason: reason })
      .where(eq(tournamentEntries.id, id))
  }

  async deleteEntries(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.delete(tournamentEntries).where(inArray(tournamentEntries.id, ids))
  }

  async updateEntrySeeds(rows: { id: string; seed: number; rating: number }[]): Promise<void> {
    for (const r of rows) {
      await this.db
        .update(tournamentEntries)
        .set({ seed: r.seed, rating: r.rating })
        .where(eq(tournamentEntries.id, r.id))
    }
  }

  async saveBracket(tournamentId: string, stored: StoredBracket): Promise<number> {
    const { bracket } = stored
    const [b] = await this.db
      .insert(brackets)
      .values({ tournamentId, size: bracket.size, rounds: bracket.rounds })
      .onConflictDoUpdate({
        target: brackets.tournamentId,
        set: { size: bracket.size, rounds: bracket.rounds },
      })
      .returning({ id: brackets.id })
    if (!b) throw new Error("bracket upsert returned no row")
    const values = bracket.matches.map((m) => ({
      bracketId: b.id,
      key: m.id,
      round: m.round,
      index: m.index,
      bestOf: m.bestOf,
      entryA: m.a,
      entryB: m.b,
      seedA: m.aSeed,
      seedB: m.bSeed,
      aResolved: m.aResolved,
      bResolved: m.bResolved,
      status: m.status,
      games: m.games,
      liveMatchId: m.liveMatchId,
      provisionAttempts: stored.provisionAttempts[m.id] ?? 0,
      provisioningAt:
        stored.provisioningAt[m.id] !== undefined ? new Date(stored.provisioningAt[m.id]!) : null,
      winnerEntryId: m.winner,
      resolution: m.resolution,
      updatedAt: new Date(),
    }))
    const ex = (col: string) => sql.raw(`excluded.${col}`)
    await this.db
      .insert(bracketMatches)
      .values(values)
      .onConflictDoUpdate({
        target: [bracketMatches.bracketId, bracketMatches.key],
        set: {
          entryA: ex("entry_a"),
          entryB: ex("entry_b"),
          seedA: ex("seed_a"),
          seedB: ex("seed_b"),
          aResolved: ex("a_resolved"),
          bResolved: ex("b_resolved"),
          status: ex("status"),
          games: ex("games"),
          liveMatchId: ex("live_match_id"),
          provisionAttempts: ex("provision_attempts"),
          provisioningAt: ex("provisioning_at"),
          winnerEntryId: ex("winner_entry_id"),
          resolution: ex("resolution"),
          updatedAt: ex("updated_at"),
        },
      })
    const [v] = await this.db
      .update(tournaments)
      .set({ bracketVersion: sql`${tournaments.bracketVersion} + 1` })
      .where(eq(tournaments.id, tournamentId))
      .returning({ version: tournaments.bracketVersion })
    return v?.version ?? 0
  }

  async loadBracket(tournamentId: string): Promise<StoredBracket | null> {
    const [b] = await this.db.select().from(brackets).where(eq(brackets.tournamentId, tournamentId))
    if (!b) return null
    const rows = await this.db
      .select()
      .from(bracketMatches)
      .where(eq(bracketMatches.bracketId, b.id))
      .orderBy(asc(bracketMatches.round), asc(bracketMatches.index))
    return {
      bracket: { size: b.size, rounds: b.rounds, matches: rows.map(toMatch) },
      provisionAttempts: Object.fromEntries(rows.map((r) => [r.key, r.provisionAttempts])),
      provisioningAt: Object.fromEntries(
        rows.flatMap((r) => (r.provisioningAt ? [[r.key, r.provisioningAt.getTime()]] : [])),
      ),
    }
  }

  async findTournamentByLiveMatch(matchId: string): Promise<string | null> {
    if (!isUuid(matchId)) return null
    const [row] = await this.db
      .select({ tournamentId: brackets.tournamentId })
      .from(bracketMatches)
      .innerJoin(brackets, eq(bracketMatches.bracketId, brackets.id))
      .where(eq(bracketMatches.liveMatchId, matchId))
      .limit(1)
    return row?.tournamentId ?? null
  }

  async insertBadges(rows: BadgeRecord[]): Promise<void> {
    if (rows.length === 0) return
    await this.db
      .insert(badges)
      .values(rows)
      .onConflictDoNothing({ target: [badges.steamId, badges.tournamentId] })
  }

  async deleteBadges(tournamentId: string, steamIds: string[]): Promise<number> {
    if (steamIds.length === 0) return 0
    const rows = await this.db
      .delete(badges)
      .where(and(eq(badges.tournamentId, tournamentId), inArray(badges.steamId, steamIds)))
      .returning({ id: badges.id })
    return rows.length
  }

  async listSchedules(): Promise<ScheduleRecord[]> {
    const rows = await this.db
      .select()
      .from(cupSchedules)
      .orderBy(asc(cupSchedules.cadence), asc(cupSchedules.mode), asc(cupSchedules.startTime))
    return rows.map(toSchedule)
  }

  async getSchedule(id: string): Promise<ScheduleRecord | null> {
    if (!isUuid(id)) return null
    const [row] = await this.db.select().from(cupSchedules).where(eq(cupSchedules.id, id))
    return row ? toSchedule(row) : null
  }

  async insertSchedule(s: NewSchedule): Promise<ScheduleRecord> {
    const [row] = await this.db.insert(cupSchedules).values(s).returning()
    if (!row) throw new Error("schedule insert returned no row")
    return toSchedule(row)
  }

  async updateSchedule(id: string, patch: Partial<NewSchedule>): Promise<ScheduleRecord | null> {
    if (!isUuid(id)) return null
    const [row] = await this.db
      .update(cupSchedules)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(cupSchedules.id, id))
      .returning()
    return row ? toSchedule(row) : null
  }

  async deleteSchedule(id: string): Promise<boolean> {
    if (!isUuid(id)) return false
    const rows = await this.db.delete(cupSchedules).where(eq(cupSchedules.id, id)).returning({ id: cupSchedules.id })
    return rows.length > 0
  }

  async writeAudit(row: AuditRow): Promise<void> {
    await this.db.insert(adminAudit).values({ ...row, payload: row.payload ?? {} })
  }

  async locked<T>(tournamentId: string, fn: (store: TournamentStore) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.id, tournamentId)).for("update")
      return fn(new DrizzleTournamentStore(tx as unknown as Db))
    })
  }
}
