import { and, asc, count, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm"
import {
  bans,
  cooldowns,
  flags,
  matchPlayers,
  matchRounds,
  matches,
  ratings,
  reports,
  steamProfiles,
  trustLevels,
  trustSignals,
  users,
} from "../../db/schema.js"
import { namePattern } from "../stats/rank.js"
import { adminAudit } from "./schema.js"
import type {
  ActiveMatchRef,
  AuditAction,
  AuditEntry,
  BanView,
  Db,
  MatchDetailView,
  MatchSummaryView,
  Mode,
  TrustLevel,
  UserCard,
  UserDetailView,
  UserSearchHit,
} from "./types.js"

export interface Counts {
  usersTotal: number
  usersNew24h: number
  matchesFinished24h: number
  matchesAbandoned24h: number
  activeBans: number
  openReports: number
  openFlags: number
}

export type NewAudit = { adminSteamId: string; action: AuditAction; target: string; payload: unknown }

// User detail without the audit list and live state, which the routes add.
export type UserRecord = Omit<UserDetailView, "audit" | "state">

export type ClearedCooldown = { reason: string; endsAt: string; offence: number }

export interface AdminStore {
  ping(): Promise<void>
  counts(now: Date): Promise<Counts>
  userCards(steamIds: string[]): Promise<Map<string, UserCard>>
  userExists(steamId: string): Promise<boolean>
  // Inserts a bare user row named after the id. True when it was created
  ensureUser(steamId: string): Promise<boolean>
  // Newest first
  listMatches(statuses: string[], limit: number): Promise<MatchSummaryView[]>
  getMatch(id: string): Promise<MatchDetailView | null>
  getUser(steamId: string, now: Date): Promise<UserRecord | null>
  // Name contains search, exact names first. A digit query also matches SteamID64 prefixes
  searchUsers(q: string, limit: number, now: Date): Promise<UserSearchHit[]>
  // Most recent sign ups first
  newestUsers(limit: number, now: Date): Promise<UserSearchHit[]>
  // Newest match in one of the statuses that the player is on
  activeMatchOf(steamId: string, statuses: string[]): Promise<ActiveMatchRef | null>
  // Ends every running cooldown now. Rows stay so the escalation ladder still counts them
  clearCooldowns(steamId: string, now: Date): Promise<ClearedCooldown[]>
  writeAudit(entry: NewAudit): Promise<AuditEntry>
  // Newest first
  listAudit(opts: { target?: string; limit: number }): Promise<AuditEntry[]>
}

export const iso = (v: Date | string | number | null | undefined): string | null =>
  v === null || v === undefined ? null : new Date(v).toISOString()

const isoReq = (v: Date | string | number) => new Date(v).toISOString()

type UserHitRow = Omit<UserSearchHit, "createdAt" | "lastLoginAt" | "trustLevel"> & {
  createdAt: Date
  lastLoginAt: Date
  trustLevel: string | null
}

const toHit = (r: UserHitRow): UserSearchHit => ({
  steamId: r.steamId,
  displayName: r.displayName,
  avatarUrl: r.avatarUrl,
  createdAt: isoReq(r.createdAt),
  lastLoginAt: isoReq(r.lastLoginAt),
  trustLevel: (r.trustLevel as TrustLevel | null) ?? null,
  banned: Boolean(r.banned),
})

export function fallbackCard(steamId: string): UserCard {
  return { steamId, displayName: steamId, avatarUrl: null }
}

export function banView(
  b: { id: string; reason: string; bannedBy: string | null; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null },
  now: Date,
): BanView {
  const active = !b.revokedAt && (!b.expiresAt || b.expiresAt.getTime() > now.getTime())
  return {
    id: b.id,
    reason: b.reason,
    bannedBy: b.bannedBy,
    createdAt: isoReq(b.createdAt),
    expiresAt: iso(b.expiresAt),
    revokedAt: iso(b.revokedAt),
    active,
  }
}

type MatchRow = typeof matches.$inferSelect

function summaryFromRow(m: MatchRow, cards: Map<string, UserCard>): MatchSummaryView {
  return {
    id: m.id,
    mode: m.mode as Mode,
    status: m.status,
    source: m.source,
    region: m.region,
    teams: m.teams.map((t) => ({
      name: t.name,
      players: t.steamIds.map((id) => cards.get(id) ?? fallbackCard(id)),
    })),
    mapId: m.mapId,
    hostId: m.hostId,
    server: m.serverIp && m.serverPort ? { ip: m.serverIp, port: m.serverPort, connect: m.connect } : null,
    winnerTeam: m.winnerTeam,
    score: m.score,
    tournamentId: m.tournamentId,
    cancelReason: m.cancelReason,
    createdAt: isoReq(m.createdAt),
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
  }
}

function auditView(r: typeof adminAudit.$inferSelect): AuditEntry {
  return {
    id: r.id,
    adminSteamId: r.adminSteamId,
    action: r.action as AuditAction,
    target: r.target,
    payload: r.payload,
    createdAt: isoReq(r.createdAt),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

export class DrizzleAdminStore implements AdminStore {
  constructor(private readonly db: Db) {}

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`)
  }

  async counts(now: Date): Promise<Counts> {
    const since = new Date(now.getTime() - DAY_MS)
    const one = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0)
    const [usersTotal, usersNew24h, matchesFinished24h, matchesAbandoned24h, activeBans, openReports, openFlags] =
      await Promise.all([
        one(this.db.select({ n: count() }).from(users)),
        one(this.db.select({ n: count() }).from(users).where(gte(users.createdAt, since))),
        one(
          this.db
            .select({ n: count() })
            .from(matches)
            .where(and(eq(matches.status, "finished"), gte(matches.endedAt, since))),
        ),
        one(
          this.db
            .select({ n: count() })
            .from(matches)
            .where(and(eq(matches.status, "abandoned"), gte(matches.endedAt, since))),
        ),
        one(
          this.db
            .select({ n: sql<number>`count(distinct ${bans.steamId})`.mapWith(Number) })
            .from(bans)
            .where(and(isNull(bans.revokedAt), or(isNull(bans.expiresAt), gt(bans.expiresAt, now)))),
        ),
        one(this.db.select({ n: count() }).from(reports).where(eq(reports.status, "open"))),
        one(this.db.select({ n: count() }).from(flags).where(eq(flags.status, "open"))),
      ])
    return { usersTotal, usersNew24h, matchesFinished24h, matchesAbandoned24h, activeBans, openReports, openFlags }
  }

  async userCards(steamIds: string[]): Promise<Map<string, UserCard>> {
    const ids = [...new Set(steamIds)]
    const out = new Map<string, UserCard>()
    if (ids.length === 0) return out
    const rows = await this.db
      .select({ steamId: users.steamId, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.steamId, ids))
    for (const r of rows) out.set(r.steamId, r)
    return out
  }

  async userExists(steamId: string): Promise<boolean> {
    const rows = await this.db.select({ id: users.steamId }).from(users).where(eq(users.steamId, steamId)).limit(1)
    return rows.length > 0
  }

  async ensureUser(steamId: string): Promise<boolean> {
    const rows = await this.db
      .insert(users)
      .values({ steamId, displayName: steamId })
      .onConflictDoNothing({ target: users.steamId })
      .returning({ steamId: users.steamId })
    return rows.length > 0
  }

  async listMatches(statuses: string[], limit: number): Promise<MatchSummaryView[]> {
    if (statuses.length === 0) return []
    const rows = await this.db
      .select()
      .from(matches)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(inArray(matches.status, statuses as any))
      .orderBy(desc(matches.createdAt))
      .limit(limit)
    const cards = await this.userCards(rows.flatMap((m) => m.teams.flatMap((t) => t.steamIds)))
    return rows.map((m) => summaryFromRow(m, cards))
  }

  async getMatch(id: string): Promise<MatchDetailView | null> {
    const [m] = await this.db.select().from(matches).where(eq(matches.id, id)).limit(1)
    if (!m) return null
    const [players, rounds] = await Promise.all([
      this.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, id)),
      this.db.select().from(matchRounds).where(eq(matchRounds.matchId, id)).orderBy(matchRounds.round),
    ])
    const cards = await this.userCards([...m.teams.flatMap((t) => t.steamIds), ...players.map((p) => p.steamId)])
    return {
      ...summaryFromRow(m, cards),
      maps: m.maps,
      acceptDeadline: iso(m.acceptDeadline),
      readyAt: iso(m.readyAt),
      players: players.map((p) => ({
        ...(cards.get(p.steamId) ?? fallbackCard(p.steamId)),
        team: p.team,
        accepted: p.accepted,
        connected: p.connected,
        abandoned: p.abandoned,
        won: p.won,
        kills: p.kills,
        deaths: p.deaths,
        headshots: p.headshots,
        damage: p.damage,
      })),
      rounds: rounds.map((r) => ({ round: r.round, winnerTeam: r.winnerTeam, score: r.score, arena: r.arena })),
    }
  }

  async getUser(steamId: string, now: Date): Promise<UserRecord | null> {
    const [u] = await this.db.select().from(users).where(eq(users.steamId, steamId)).limit(1)
    if (!u) return null
    const [steam, trust, signals, ratingRows, recent, banRows, cds, reportRows, flagRows] = await Promise.all([
      this.db.select().from(steamProfiles).where(eq(steamProfiles.steamId, steamId)).limit(1),
      this.db.select().from(trustLevels).where(eq(trustLevels.steamId, steamId)).limit(1),
      this.db
        .select()
        .from(trustSignals)
        .where(eq(trustSignals.steamId, steamId))
        .orderBy(desc(trustSignals.fetchedAt))
        .limit(20),
      this.db.select().from(ratings).where(eq(ratings.steamId, steamId)),
      this.db
        .select({ m: matches, p: matchPlayers })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(eq(matchPlayers.steamId, steamId))
        .orderBy(desc(matches.createdAt))
        .limit(20),
      this.db.select().from(bans).where(eq(bans.steamId, steamId)).orderBy(desc(bans.createdAt)),
      this.db
        .select()
        .from(cooldowns)
        .where(and(eq(cooldowns.steamId, steamId), gt(cooldowns.endsAt, now)))
        .orderBy(desc(cooldowns.endsAt)),
      this.db
        .select({ status: reports.status, n: count() })
        .from(reports)
        .where(eq(reports.reportedSteamId, steamId))
        .groupBy(reports.status),
      this.db
        .select({ status: flags.status, n: count() })
        .from(flags)
        .where(eq(flags.steamId, steamId))
        .groupBy(flags.status),
    ])
    const s = steam[0]
    const t = trust[0]
    const banViews = banRows.map((b) => banView(b, now))
    const sum = (rows: { n: number }[]) => rows.reduce((a, r) => a + Number(r.n), 0)
    return {
      user: {
        steamId: u.steamId,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        region: u.region,
        countryCode: u.countryCode,
        profileUrl: u.profileUrl,
        createdAt: isoReq(u.createdAt),
        lastLoginAt: isoReq(u.lastLoginAt),
      },
      steam: s
        ? {
            personaName: s.personaName,
            accountCreatedAt: iso(s.accountCreatedAt),
            cs2PlaytimeMinutes: s.cs2PlaytimeMinutes,
            communityVisibility: s.communityVisibility,
            fetchedAt: isoReq(s.fetchedAt),
          }
        : null,
      trust: t ? { level: t.level as TrustLevel, reason: t.reason, locked: t.locked, updatedAt: isoReq(t.updatedAt) } : null,
      trustSignals: signals.map((x) => ({
        id: x.id,
        source: x.source,
        clean: x.clean,
        data: x.data,
        fetchedAt: isoReq(x.fetchedAt),
      })),
      ratings: ratingRows.map((r) => ({
        mode: r.mode as Mode,
        rating: r.rating,
        rd: r.rd,
        matchesPlayed: r.matchesPlayed,
        wins: r.wins,
        losses: r.losses,
        updatedAt: isoReq(r.updatedAt),
      })),
      recentMatches: recent.map(({ m, p }) => ({
        id: m.id,
        slug: m.slug,
        bestOf: m.bestOf,
        mode: m.mode as Mode,
        status: m.status,
        team: p.team,
        won: p.won,
        abandoned: p.abandoned,
        kills: p.kills,
        deaths: p.deaths,
        headshots: p.headshots,
        score: m.score,
        mapId: m.mapId,
        createdAt: isoReq(m.createdAt),
      })),
      bans: banViews,
      activeBan: banViews.find((b) => b.active) ?? null,
      cooldowns: cds.map((c) => ({ reason: c.reason, endsAt: isoReq(c.endsAt), offence: c.offence })),
      reports: { received: sum(reportRows), open: sum(reportRows.filter((r) => r.status === "open")) },
      flags: { total: sum(flagRows), open: sum(flagRows.filter((r) => r.status === "open")) },
    }
  }

  async searchUsers(q: string, limit: number, now: Date): Promise<UserSearchHit[]> {
    const lower = q.toLowerCase()
    const prefix = namePattern(q).replace(/^%/, "")
    const byName = sql`lower(${users.displayName}) like ${namePattern(q)}`
    const where = /^\d{3,17}$/.test(q) ? or(byName, sql`${users.steamId} like ${`${q}%`}`) : byName
    const rows = await this.userHits(now)
      .where(where)
      .orderBy(
        sql`case when lower(${users.displayName}) = ${lower} or ${users.steamId} = ${q} then 0 when lower(${users.displayName}) like ${prefix} then 1 else 2 end`,
        desc(users.lastLoginAt),
        asc(users.steamId),
      )
      .limit(limit)
    return rows.map(toHit)
  }

  async newestUsers(limit: number, now: Date): Promise<UserSearchHit[]> {
    const rows = await this.userHits(now).orderBy(desc(users.createdAt), asc(users.steamId)).limit(limit)
    return rows.map(toHit)
  }

  private userHits(now: Date) {
    return this.db
      .select({
        steamId: users.steamId,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        trustLevel: trustLevels.level,
        banned: sql<boolean>`exists (select 1 from ${bans} where ${bans.steamId} = ${users.steamId} and ${bans.revokedAt} is null and (${bans.expiresAt} is null or ${bans.expiresAt} > ${now.toISOString()}::timestamptz))`,
      })
      .from(users)
      .leftJoin(trustLevels, eq(trustLevels.steamId, users.steamId))
      .$dynamic()
  }

  async activeMatchOf(steamId: string, statuses: string[]): Promise<ActiveMatchRef | null> {
    if (statuses.length === 0) return null
    const [row] = await this.db
      .select({ id: matches.id, slug: matches.slug, mode: matches.mode, status: matches.status, createdAt: matches.createdAt })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(and(eq(matchPlayers.steamId, steamId), inArray(matches.status, statuses as any)))
      .orderBy(desc(matches.createdAt))
      .limit(1)
    return row ? { ...row, mode: row.mode as Mode, createdAt: isoReq(row.createdAt) } : null
  }

  async clearCooldowns(steamId: string, now: Date): Promise<ClearedCooldown[]> {
    const rows = await this.db
      .select({ id: cooldowns.id, reason: cooldowns.reason, endsAt: cooldowns.endsAt, offence: cooldowns.offence })
      .from(cooldowns)
      .where(and(eq(cooldowns.steamId, steamId), gt(cooldowns.endsAt, now)))
    if (rows.length === 0) return []
    await this.db
      .update(cooldowns)
      .set({ endsAt: now })
      .where(inArray(cooldowns.id, rows.map((r) => r.id)))
    return rows.map((r) => ({ reason: r.reason, endsAt: isoReq(r.endsAt), offence: r.offence }))
  }

  async writeAudit(entry: NewAudit): Promise<AuditEntry> {
    const [row] = await this.db
      .insert(adminAudit)
      .values({
        adminSteamId: entry.adminSteamId,
        action: entry.action,
        target: entry.target,
        payload: entry.payload ?? {},
      })
      .returning()
    return auditView(row!)
  }

  async listAudit(opts: { target?: string; limit: number }): Promise<AuditEntry[]> {
    const rows = await this.db
      .select()
      .from(adminAudit)
      .where(opts.target ? eq(adminAudit.target, opts.target) : undefined)
      .orderBy(desc(adminAudit.createdAt))
      .limit(opts.limit)
    return rows.map(auditView)
  }
}
