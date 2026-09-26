import { randomUUID } from "node:crypto"
import type { AdminStore, ClearedCooldown, Counts, NewAudit, UserRecord } from "./store.js"
import type { ActiveMatchRef, AuditEntry, MatchDetailView, MatchSummaryView, UserCard, UserSearchHit } from "./types.js"

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

  async ensureUser(steamId: string): Promise<boolean> {
    if (this.users.has(steamId)) return false
    const at = new Date().toISOString()
    this.users.set(steamId, {
      user: { steamId, displayName: steamId, avatarUrl: null, region: "eu", countryCode: null, profileUrl: null, createdAt: at, lastLoginAt: at },
      steam: null,
      trust: null,
      trustSignals: [],
      ratings: [],
      recentMatches: [],
      bans: [],
      activeBan: null,
      cooldowns: [],
      reports: { received: 0, open: 0 },
      flags: { open: 0, total: 0 },
    })
    return true
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

  async searchUsers(q: string, limit: number, now: Date): Promise<UserSearchHit[]> {
    const lower = q.toLowerCase()
    const rank = (r: UserRecord) => {
      const name = r.user.displayName.toLowerCase()
      if (name === lower || r.user.steamId === q) return 0
      if (name.startsWith(lower)) return 1
      if (q.length >= 3 && name.includes(lower)) return 2
      if (/^\d{3,17}$/.test(q) && r.user.steamId.startsWith(q)) return 2
      return -1
    }
    return [...this.users.values()]
      .map((r) => ({ r, n: rank(r) }))
      .filter((x) => x.n >= 0)
      .sort((a, b) => a.n - b.n || b.r.user.lastLoginAt.localeCompare(a.r.user.lastLoginAt) || a.r.user.steamId.localeCompare(b.r.user.steamId))
      .slice(0, limit)
      .map(({ r }) => this.hit(r, now))
  }

  async newestUsers(limit: number, now: Date): Promise<UserSearchHit[]> {
    return [...this.users.values()]
      .sort((a, b) => b.user.createdAt.localeCompare(a.user.createdAt) || a.user.steamId.localeCompare(b.user.steamId))
      .slice(0, limit)
      .map((r) => this.hit(r, now))
  }

  private hit(r: UserRecord, now: Date): UserSearchHit {
    return {
      steamId: r.user.steamId,
      displayName: r.user.displayName,
      avatarUrl: r.user.avatarUrl,
      createdAt: r.user.createdAt,
      lastLoginAt: r.user.lastLoginAt,
      trustLevel: r.trust?.level ?? null,
      banned: r.bans.some((b) => !b.revokedAt && (!b.expiresAt || Date.parse(b.expiresAt) > now.getTime())),
    }
  }

  async activeMatchOf(steamId: string, statuses: string[]): Promise<ActiveMatchRef | null> {
    const m = this.matches
      .filter((x) => statuses.includes(x.status) && x.teams.some((t) => t.players.some((p) => p.steamId === steamId)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return m ? { id: m.id, slug: null, mode: m.mode, status: m.status, createdAt: m.createdAt } : null
  }

  async clearCooldowns(steamId: string, now: Date): Promise<ClearedCooldown[]> {
    const u = this.users.get(steamId)
    if (!u) return []
    const running = u.cooldowns.filter((c) => Date.parse(c.endsAt) > now.getTime())
    u.cooldowns = u.cooldowns.filter((c) => !running.includes(c))
    return running
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
