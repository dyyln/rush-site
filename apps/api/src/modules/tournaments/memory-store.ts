// In-memory TournamentStore for tests.
import { randomUUID } from "node:crypto"
import type {
  AuditRow,
  BadgeRecord,
  EntryRecord,
  NewEntry,
  NewSchedule,
  NewTournament,
  ScheduleRecord,
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
  schedules = new Map<string, ScheduleRecord>()
  audit: AuditRow[] = []
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
    if (!t) return
    const next = { ...t, ...patch, id }
    for (const x of this.tournaments.values()) {
      if (x.id !== id && x.cupKey === next.cupKey && +x.startsAt === +next.startsAt) {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" })
      }
    }
    this.tournaments.set(id, next)
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
      if (ids.includes(e.tournamentId) && !e.disqualifiedAt) out[e.tournamentId] = (out[e.tournamentId] ?? 0) + 1
    }
    return out
  }

  async findPlayerEntries(steamId: string, ids: string[]) {
    const out: Record<string, string> = {}
    for (const e of this.entries.values()) {
      if (ids.includes(e.tournamentId) && e.steamIds.includes(steamId) && !e.disqualifiedAt) out[e.tournamentId] = e.id
    }
    return out
  }

  async insertEntry(e: NewEntry) {
    const row: EntryRecord = {
      ...e,
      teamName: e.teamName ?? null,
      disqualifiedAt: null,
      disqualifyReason: null,
      id: randomUUID(),
      seed: null,
      rating: null,
      createdAt: new Date(1_700_000_000_000 + this.clock++),
    }
    this.entries.set(row.id, row)
    return { ...row }
  }

  async disqualifyEntry(id: string, reason: string, at: Date) {
    const e = this.entries.get(id)
    if (e) this.entries.set(id, { ...e, disqualifiedAt: at, disqualifyReason: reason })
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

  async deleteBadges(tournamentId: string, steamIds: string[]) {
    const before = this.badges.length
    this.badges = this.badges.filter((b) => !(b.tournamentId === tournamentId && steamIds.includes(b.steamId)))
    return before - this.badges.length
  }

  async listSchedules() {
    return [...this.schedules.values()].map((x) => ({ ...x }))
  }

  async getSchedule(id: string) {
    const x = this.schedules.get(id)
    return x ? { ...x } : null
  }

  async insertSchedule(s: NewSchedule) {
    const row: ScheduleRecord = { ...s, id: randomUUID(), updatedAt: new Date() }
    this.schedules.set(row.id, row)
    return { ...row }
  }

  async updateSchedule(id: string, patch: Partial<NewSchedule>) {
    const x = this.schedules.get(id)
    if (!x) return null
    const row = { ...x, ...patch, id, updatedAt: new Date() }
    this.schedules.set(id, row)
    return { ...row }
  }

  async deleteSchedule(id: string) {
    return this.schedules.delete(id)
  }

  async writeAudit(row: AuditRow) {
    this.audit.push(row)
  }

  async locked<T>(tournamentId: string, fn: (s: TournamentStore) => Promise<T>): Promise<T> {
    const prev = this.locks.get(tournamentId) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(() => fn(this))
    this.locks.set(tournamentId, run)
    return run
  }
}
