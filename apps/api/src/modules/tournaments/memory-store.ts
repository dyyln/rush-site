// In-memory TournamentStore for tests.
import { randomUUID } from "node:crypto"
import type {
  BadgeRecord,
  EntryRecord,
  NewTournament,
  StoredBracket,
  TournamentFilter,
  TournamentRecord,
  TournamentStore,
} from "./store.js"

export class MemoryTournamentStore implements TournamentStore {
  tournaments = new Map<string, TournamentRecord>()
  entries = new Map<string, EntryRecord>()
  brackets = new Map<string, StoredBracket>()
  badges: BadgeRecord[] = []
  private locks = new Map<string, Promise<unknown>>()
  private clock = 0

  async createTournament(t: NewTournament): Promise<string | null> {
    for (const x of this.tournaments.values()) {
      if (x.cupKey === t.cupKey && +x.startsAt === +t.startsAt) return null
    }
    const id = randomUUID()
    this.tournaments.set(id, {
      ...t,
      id,
      status: "open",
      startedAt: null,
      completedAt: null,
      cancelReason: null,
      winnerEntryId: null,
      bracketVersion: 0,
    })
    return id
  }

  async getTournament(id: string) {
    const t = this.tournaments.get(id)
    return t ? { ...t } : null
  }

  async listTournaments(f: TournamentFilter) {
    return [...this.tournaments.values()]
      .filter((t) => !f.status?.length || f.status.includes(t.status))
      .filter((t) => !f.mode || t.mode === f.mode)
      .filter((t) => !f.startsBefore || t.startsAt <= f.startsBefore)
      .sort((a, b) => +a.startsAt - +b.startsAt)
      .slice(0, f.limit ?? 100)
      .map((t) => ({ ...t }))
  }

  async updateTournament(id: string, patch: Partial<TournamentRecord>) {
    const t = this.tournaments.get(id)
    if (t) this.tournaments.set(id, { ...t, ...patch, id })
  }

  async listEntries(tournamentId: string) {
    return [...this.entries.values()]
      .filter((e) => e.tournamentId === tournamentId)
      .sort((a, b) => +a.createdAt - +b.createdAt)
      .map((e) => ({ ...e }))
  }

  async countEntries(ids: string[]) {
    const out: Record<string, number> = {}
    for (const e of this.entries.values()) {
      if (ids.includes(e.tournamentId)) out[e.tournamentId] = (out[e.tournamentId] ?? 0) + 1
    }
    return out
  }

  async findPlayerEntries(steamId: string, ids: string[]) {
    const out: Record<string, string> = {}
    for (const e of this.entries.values()) {
      if (ids.includes(e.tournamentId) && e.steamIds.includes(steamId)) out[e.tournamentId] = e.id
    }
    return out
  }

  async insertEntry(e: Omit<EntryRecord, "id" | "createdAt" | "seed" | "rating">) {
    const row: EntryRecord = {
      ...e,
      id: randomUUID(),
      seed: null,
      rating: null,
      createdAt: new Date(1_700_000_000_000 + this.clock++),
    }
    this.entries.set(row.id, row)
    return { ...row }
  }

  async deleteEntries(ids: string[]) {
    for (const id of ids) this.entries.delete(id)
  }

  async updateEntrySeeds(rows: { id: string; seed: number; rating: number }[]) {
    for (const r of rows) {
      const e = this.entries.get(r.id)
      if (e) this.entries.set(r.id, { ...e, seed: r.seed, rating: r.rating })
    }
  }

  async saveBracket(tournamentId: string, stored: StoredBracket) {
    this.brackets.set(tournamentId, structuredClone(stored))
    const t = this.tournaments.get(tournamentId)
    if (!t) return 0
    t.bracketVersion += 1
    return t.bracketVersion
  }

  async loadBracket(tournamentId: string) {
    const b = this.brackets.get(tournamentId)
    return b ? structuredClone(b) : null
  }

  async findTournamentByLiveMatch(matchId: string) {
    for (const [id, s] of this.brackets) {
      if (s.bracket.matches.some((m) => m.liveMatchId === matchId)) return id
    }
    return null
  }

  async insertBadges(rows: BadgeRecord[]) {
    for (const r of rows) {
      if (!this.badges.some((b) => b.steamId === r.steamId && b.tournamentId === r.tournamentId)) {
        this.badges.push(r)
      }
    }
  }

  async locked<T>(tournamentId: string, fn: (s: TournamentStore) => Promise<T>): Promise<T> {
    const prev = this.locks.get(tournamentId) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(() => fn(this))
    this.locks.set(tournamentId, run)
    return run
  }
}
