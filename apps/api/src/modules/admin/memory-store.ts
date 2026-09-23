import { randomUUID } from "node:crypto"
import type { AdminStore, Counts, NewAudit, UserRecord } from "./store.js"
import type { AuditEntry, MatchDetailView, MatchSummaryView, UserCard } from "./types.js"

// In-memory store for tests. Seed the public fields directly.
export class MemoryAdminStore implements AdminStore {
  users = new Map<string, UserRecord>()
  matches: MatchDetailView[] = []
  audit: AuditEntry[] = []
  counters: Counts = {
    usersTotal: 0,
    usersNew24h: 0,
    matchesFinished24h: 0,
    matchesAbandoned24h: 0,
    activeBans: 0,
    openReports: 0,
    openFlags: 0,
  }
  failPing = false
  failAudit = false

  async ping(): Promise<void> {
    if (this.failPing) throw new Error("db down")
  }

  async counts(): Promise<Counts> {
    return { ...this.counters, usersTotal: this.counters.usersTotal || this.users.size }
  }

  async userCards(steamIds: string[]): Promise<Map<string, UserCard>> {
    const out = new Map<string, UserCard>()
    for (const id of steamIds) {
      const u = this.users.get(id)?.user
      if (u) out.set(id, { steamId: u.steamId, displayName: u.displayName, avatarUrl: u.avatarUrl })
    }
    return out
  }

  async userExists(steamId: string): Promise<boolean> {
    return this.users.has(steamId)
  }

  async listMatches(statuses: string[], limit: number): Promise<MatchSummaryView[]> {
    return this.matches
      .filter((m) => statuses.includes(m.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  async getMatch(id: string): Promise<MatchDetailView | null> {
    return this.matches.find((m) => m.id === id) ?? null
  }

  async getUser(steamId: string): Promise<UserRecord | null> {
    return this.users.get(steamId) ?? null
  }

  async writeAudit(entry: NewAudit): Promise<AuditEntry> {
    if (this.failAudit) throw new Error("audit write failed")
    const row: AuditEntry = {
      id: randomUUID(),
      adminSteamId: entry.adminSteamId,
      action: entry.action,
      target: entry.target,
      payload: entry.payload ?? {},
      createdAt: new Date(Date.now() + this.audit.length).toISOString(),
    }
    this.audit.push(row)
    return row
  }

  async listAudit(opts: { target?: string; limit: number }): Promise<AuditEntry[]> {
    return this.audit
      .filter((a) => !opts.target || a.target === opts.target)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts.limit)
  }
}
