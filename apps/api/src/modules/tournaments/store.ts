import { and, asc, count, eq, inArray, lte, sql } from "drizzle-orm"
import type { Bracket, BracketMatch, Resolution } from "./bracket.js"
import type { CupFormat } from "./config.js"
import { badges, bracketMatches, brackets, tournamentEntries, tournaments } from "./schema.js"
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
}

export type NewTournament = Omit<
  TournamentRecord,
  "id" | "status" | "startedAt" | "completedAt" | "cancelReason" | "winnerEntryId"
>

export interface EntryRecord {
  id: string
  tournamentId: string
  captainSteamId: string
  steamIds: string[]
  seed: number | null
  rating: number | null
  createdAt: Date
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
  listEntries(tournamentId: string): Promise<EntryRecord[]>
  countEntries(tournamentIds: string[]): Promise<Record<string, number>>
  insertEntry(e: Omit<EntryRecord, "id" | "createdAt" | "seed" | "rating">): Promise<EntryRecord>
  deleteEntries(ids: string[]): Promise<void>
  updateEntrySeeds(rows: { id: string; seed: number; rating: number }[]): Promise<void>
  saveBracket(tournamentId: string, stored: StoredBracket): Promise<void>
  loadBracket(tournamentId: string): Promise<StoredBracket | null>
  findTournamentByLiveMatch(matchId: string): Promise<string | null>
  insertBadges(rows: BadgeRecord[]): Promise<void>
  // Runs fn with the tournament row locked. Do not nest.
  locked<T>(tournamentId: string, fn: (store: TournamentStore) => Promise<T>): Promise<T>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID_RE.test(s)

type TRow = typeof tournaments.$inferSelect
type ERow = typeof tournamentEntries.$inferSelect
type MRow = typeof bracketMatches.$inferSelect

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
      .where(inArray(tournamentEntries.tournamentId, tournamentIds))
      .groupBy(tournamentEntries.tournamentId)
    return Object.fromEntries(rows.map((r) => [r.id, Number(r.n)]))
  }

  async insertEntry(
    e: Omit<EntryRecord, "id" | "createdAt" | "seed" | "rating">,
  ): Promise<EntryRecord> {
    const [row] = await this.db.insert(tournamentEntries).values(e).returning()
    return toEntry(row)
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

  async saveBracket(tournamentId: string, stored: StoredBracket): Promise<void> {
    const { bracket } = stored
    const [b] = await this.db
      .insert(brackets)
      .values({ tournamentId, size: bracket.size, rounds: bracket.rounds })
      .onConflictDoUpdate({
        target: brackets.tournamentId,
        set: { size: bracket.size, rounds: bracket.rounds },
      })
      .returning({ id: brackets.id })
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
          winnerEntryId: ex("winner_entry_id"),
          resolution: ex("resolution"),
          updatedAt: ex("updated_at"),
        },
      })
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

  async locked<T>(tournamentId: string, fn: (store: TournamentStore) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.id, tournamentId)).for("update")
      return fn(new DrizzleTournamentStore(tx as unknown as Db))
    })
  }
}
