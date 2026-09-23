import {
  AUTO_FLAG_MIN_REPORTS,
  type FlagStatus,
  type MatchStatus,
  type MyReport,
  type ReportOutcome,
  type ReportReason,
  type ReviewDecideBody,
  type ReviewDecideResponse,
  type ReviewFlag,
  type ReviewListResponse,
  type ReviewMatch,
  type TrustLevel,
} from "@rushsite/shared"
import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import type { AppContext } from "../../context.js"
import type { Db } from "../../db/client.js"
import { adminAudit, demos, flags, matchPlayers, matches, ratings, reports, reviews } from "../../db/schema.js"
import { conflict, notFound } from "../../lib/errors.js"
import { teamScores } from "../match/match-page.js"

type FlagRow = typeof flags.$inferSelect
type Card = { steamId: string; displayName: string; avatarUrl: string | null }

export type ReviewDeps = Pick<AppContext, "db" | "users" | "trust" | "bans" | "ratings" | "events" | "log" | "now" | "env">

// Legacy dismissed rows read as cleared
const statusView = (s: FlagRow["status"]): FlagStatus => (s === "dismissed" ? "cleared" : s)

const LIST_LIMIT = 100
const DECIDED: FlagRow["status"][] = ["cleared", "confirmed", "dismissed"]

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export class ReviewService {
  constructor(private readonly deps: ReviewDeps) {}

  private get db(): Db {
    return this.deps.db
  }

  // Runs after a report is stored. Opens a flag on 2+ reports against one player in one match or on any report from a Trusted player
  async onReport(report: { reporter: string; target: string; matchId: string }): Promise<{ flagId: string | null; created: boolean }> {
    const { reporter, target, matchId } = report
    const [existing] = await this.db
      .select()
      .from(flags)
      .where(and(eq(flags.steamId, target), eq(flags.matchId, matchId)))
    if (existing) {
      // Late reports follow the case they join
      const outcome = outcomeFor(existing.status)
      if (outcome !== "received") await this.setReportOutcome(target, matchId, outcome, outcome === "reviewed" ? ["received"] : undefined)
      return { flagId: existing.id, created: false }
    }

    const [n] = await this.db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.reportedSteamId, target), eq(reports.matchId, matchId)))
    const reportCount = n?.n ?? 0
    const reporterTrust = (await this.deps.trust.levels([reporter]))[reporter] ?? "new"
    const trustedReporter = reporterTrust === "trusted"
    if (reportCount < AUTO_FLAG_MIN_REPORTS && !trustedReporter) return { flagId: null, created: false }

    const [row] = await this.db
      .insert(flags)
      .values({
        steamId: target,
        matchId,
        source: "reports",
        status: "open",
        detail: { reports: reportCount, trustedReporter },
      })
      .onConflictDoNothing()
      .returning({ id: flags.id })
    if (!row) {
      const [again] = await this.db
        .select({ id: flags.id })
        .from(flags)
        .where(and(eq(flags.steamId, target), eq(flags.matchId, matchId)))
      return { flagId: again?.id ?? null, created: false }
    }
    // Flagged demos are kept until review is done
    await this.db.update(demos).set({ keep: true }).where(eq(demos.matchId, matchId))
    await this.recomputeTrust(target)
    this.deps.events.emit("user", { action: "flagged", steamId: target, matchId, flagId: row.id })
    return { flagId: row.id, created: true }
  }

  async counts(): Promise<Record<FlagStatus, number>> {
    const rows = await this.db.select({ status: flags.status, n: count() }).from(flags).groupBy(flags.status)
    const out: Record<FlagStatus, number> = { open: 0, reviewing: 0, cleared: 0, confirmed: 0 }
    for (const r of rows) out[statusView(r.status)] += r.n
    return out
  }

  async list(status: FlagStatus | "all"): Promise<ReviewListResponse> {
    const where: SQL | undefined =
      status === "all" ? undefined : status === "cleared" ? inArray(flags.status, ["cleared", "dismissed"]) : eq(flags.status, status)
    // Open work oldest first, decided cases newest first
    const order = status === "open" || status === "reviewing" ? [flags.createdAt] : [desc(flags.decidedAt), desc(flags.createdAt)]
    const rows = await this.db
      .select()
      .from(flags)
      .where(where)
      .orderBy(...order)
      .limit(LIST_LIMIT)
    const [views, counts] = await Promise.all([this.views(rows), this.counts()])
    return { flags: views, counts }
  }

  async get(flagId: string): Promise<ReviewFlag> {
    const [row] = await this.db.select().from(flags).where(eq(flags.id, flagId))
    if (!row) throw notFound("flag_not_found")
    return (await this.views([row]))[0]!
  }

  async claim(flagId: string, admin: string): Promise<ReviewFlag> {
    const [row] = await this.db.select().from(flags).where(eq(flags.id, flagId))
    if (!row) throw notFound("flag_not_found")
    if (row.steamId === admin) throw conflict("own_case", "You cannot review your own case")
    if (DECIDED.includes(row.status)) throw conflict("already_decided", "This case is already decided")
    if (row.status === "reviewing" && row.reviewerSteamId && row.reviewerSteamId !== admin) {
      throw conflict("already_claimed", "Another reviewer has this case")
    }
    if (row.status === "open") {
      const [updated] = await this.db
        .update(flags)
        .set({ status: "reviewing", reviewerSteamId: admin })
        .where(and(eq(flags.id, flagId), eq(flags.status, "open")))
        .returning({ id: flags.id })
      if (!updated) throw conflict("already_claimed", "Another reviewer has this case")
      if (row.matchId) await this.setReportOutcome(row.steamId, row.matchId, "reviewed", ["received"])
      await this.audit(admin, "review.claim", flagId, { steamId: row.steamId, matchId: row.matchId })
    }
    return this.get(flagId)
  }

  async decide(flagId: string, admin: string, body: ReviewDecideBody): Promise<ReviewDecideResponse> {
    const [row] = await this.db.select().from(flags).where(eq(flags.id, flagId))
    if (!row) throw notFound("flag_not_found")
    if (row.steamId === admin) throw conflict("own_case", "You cannot review your own case")
    if (DECIDED.includes(row.status)) throw conflict("already_decided", "This case is already decided")
    if (row.reviewerSteamId && row.reviewerSteamId !== admin) throw conflict("already_claimed", "Another reviewer has this case")

    const nowDate = new Date(this.deps.now())
    // The status guard makes a second decide on the same flag a no-op
    const [updated] = await this.db
      .update(flags)
      .set({ status: body.outcome, reviewerSteamId: admin, decidedAt: nowDate, resolvedAt: nowDate, note: body.note })
      .where(
        and(
          eq(flags.id, flagId),
          inArray(flags.status, ["open", "reviewing"]),
          or(isNull(flags.reviewerSteamId), eq(flags.reviewerSteamId, admin)),
        ),
      )
      .returning({ id: flags.id })
    if (!updated) throw conflict("already_decided", "This case changed while you were deciding")

    // Every ruling is a labelled training example
    await this.db.insert(reviews).values({
      flagId,
      reviewerSteamId: admin,
      verdict: body.outcome === "confirmed" ? "cheat" : "clean",
      adminOverride: false,
      note: body.note,
    })

    const outcome: ReportOutcome = body.outcome === "confirmed" ? "actioned" : "dismissed"
    const reportsUpdated = row.matchId ? await this.setReportOutcome(row.steamId, row.matchId, outcome) : 0

    let banId: string | null = null
    let rollback: ReviewDecideResponse["rollback"] = null
    if (body.outcome === "confirmed") {
      if (body.ban) {
        const until = body.ban.until ? new Date(body.ban.until) : undefined
        const res = await this.deps.bans.ban(row.steamId, body.ban.reason, { until, bannedBy: admin, rollback: true })
        banId = res.banId
        rollback = res.rollback ? rollbackView(res.rollback) : null
      } else {
        const from = new Date(this.deps.now() - this.deps.env.ROLLBACK_WINDOW_DAYS * 86400_000)
        rollback = rollbackView(await this.deps.ratings.rollbackCheater(row.steamId, from))
      }
    } else if (row.matchId) {
      // Cleared demos go back to normal retention unless another case on the match is still open
      const [other] = await this.db
        .select({ n: count() })
        .from(flags)
        .where(and(eq(flags.matchId, row.matchId), inArray(flags.status, ["open", "reviewing", "confirmed"])))
      if ((other?.n ?? 0) === 0) await this.db.update(demos).set({ keep: false }).where(eq(demos.matchId, row.matchId))
    }
    await this.recomputeTrust(row.steamId)

    await this.audit(admin, "review.decide", flagId, {
      steamId: row.steamId,
      matchId: row.matchId,
      outcome: body.outcome,
      note: body.note,
      ban: body.ban ?? null,
      banId,
      reportsUpdated,
      rollback,
    })
    this.deps.events.emit("user", { action: `review_${body.outcome}`, steamId: row.steamId, flagId, by: admin })
    return { flag: await this.get(flagId), reportsUpdated, banId, rollback }
  }

  async myReports(reporter: string, opts: { matchId?: string; limit: number }): Promise<MyReport[]> {
    const rows = await this.db
      .select({
        id: reports.id,
        matchId: reports.matchId,
        reported: reports.reportedSteamId,
        reason: reports.reason,
        note: reports.detail,
        outcome: reports.outcome,
        createdAt: reports.createdAt,
        decidedAt: flags.decidedAt,
        mode: matches.mode,
        mapId: matches.mapId,
        endedAt: matches.endedAt,
      })
      .from(reports)
      .leftJoin(flags, and(eq(flags.steamId, reports.reportedSteamId), eq(flags.matchId, reports.matchId)))
      .leftJoin(matches, eq(matches.id, reports.matchId))
      .where(and(eq(reports.reporterSteamId, reporter), opts.matchId ? eq(reports.matchId, opts.matchId) : undefined))
      .orderBy(desc(reports.createdAt))
      .limit(opts.limit)
    const cards = await this.deps.users.cards([...new Set(rows.map((r) => r.reported))])
    return rows.map((r) => ({
      id: r.id,
      matchId: r.matchId,
      reported: cardOf(cards, r.reported),
      reason: r.reason as ReportReason,
      note: r.note,
      outcome: r.outcome,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.outcome === "actioned" || r.outcome === "dismissed" ? iso(r.decidedAt) : null,
      match: r.mode ? { mode: r.mode, mapId: r.mapId, endedAt: iso(r.endedAt) } : null,
    }))
  }

  // Moves every report on the player in that match. from limits which outcomes may change
  private async setReportOutcome(target: string, matchId: string, outcome: ReportOutcome, from?: ReportOutcome[]): Promise<number> {
    const status = outcome === "actioned" ? "actioned" : outcome === "dismissed" ? "dismissed" : "open"
    const rows = await this.db
      .update(reports)
      .set({ outcome, status })
      .where(
        and(eq(reports.reportedSteamId, target), eq(reports.matchId, matchId), from ? inArray(reports.outcome, from) : undefined),
      )
      .returning({ id: reports.id })
    return rows.length
  }

  private async recomputeTrust(steamId: string): Promise<void> {
    try {
      await this.deps.trust.recompute(steamId)
    } catch (err) {
      this.deps.log.warn({ err, steamId }, "trust recompute after review failed")
    }
  }

  private async audit(admin: string, action: string, target: string, payload: unknown): Promise<void> {
    await this.db.insert(adminAudit).values({ adminSteamId: admin, action, target, payload: payload ?? {} })
  }

  private async views(rows: FlagRow[]): Promise<ReviewFlag[]> {
    if (rows.length === 0) return []
    const db = this.db
    const playerIds = [...new Set(rows.map((r) => r.steamId))]
    const matchIds = [...new Set(rows.map((r) => r.matchId).filter((m): m is string => !!m))]

    const [matchRows, playerRows, reportRows, statRows, reportTotals, flagTotals, banned, ratingRows] = await Promise.all([
      matchIds.length ? db.select().from(matches).where(inArray(matches.id, matchIds)) : [],
      matchIds.length ? db.select().from(matchPlayers).where(inArray(matchPlayers.matchId, matchIds)) : [],
      matchIds.length
        ? db
            .select()
            .from(reports)
            .where(and(inArray(reports.matchId, matchIds), inArray(reports.reportedSteamId, playerIds)))
            .orderBy(reports.createdAt)
        : [],
      db
        .select({
          steamId: matchPlayers.steamId,
          matches: count(),
          wins: sql<number>`count(*) filter (where ${matchPlayers.won})`.mapWith(Number),
          kills: sql<number>`coalesce(sum(${matchPlayers.kills}), 0)`.mapWith(Number),
          deaths: sql<number>`coalesce(sum(${matchPlayers.deaths}), 0)`.mapWith(Number),
          headshots: sql<number>`coalesce(sum(${matchPlayers.headshots}), 0)`.mapWith(Number),
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(and(inArray(matchPlayers.steamId, playerIds), eq(matches.status, "finished")))
        .groupBy(matchPlayers.steamId),
      db
        .select({ steamId: reports.reportedSteamId, n: count() })
        .from(reports)
        .where(inArray(reports.reportedSteamId, playerIds))
        .groupBy(reports.reportedSteamId),
      db
        .select({ steamId: flags.steamId, status: flags.status, n: count() })
        .from(flags)
        .where(inArray(flags.steamId, playerIds))
        .groupBy(flags.steamId, flags.status),
      this.deps.trust.activeBans(playerIds),
      db
        .select({ steamId: ratings.steamId, mode: ratings.mode, rating: ratings.rating })
        .from(ratings)
        .where(inArray(ratings.steamId, playerIds)),
    ])

    const reporterIds = reportRows.map((r) => r.reporterSteamId)
    const reviewerIds = rows.map((r) => r.reviewerSteamId).filter((s): s is string => !!s)
    const everyone = [...new Set([...playerIds, ...reporterIds, ...reviewerIds, ...playerRows.map((p) => p.steamId)])]
    const [cards, trust] = await Promise.all([
      this.deps.users.cards(everyone),
      this.deps.trust.levels([...new Set([...playerIds, ...reporterIds])]),
    ])

    const matchById = new Map(matchRows.map((m) => [m.id, m]))
    return rows.map((f) => {
      const stat = statRows.find((s) => s.steamId === f.steamId)
      const m = f.matchId ? matchById.get(f.matchId) : undefined
      const kills = stat?.kills ?? 0
      const deaths = stat?.deaths ?? 0
      const headshots = stat?.headshots ?? 0
      const flagCount = (s: FlagRow["status"][]) =>
        flagTotals.filter((t) => t.steamId === f.steamId && s.includes(t.status)).reduce((n, t) => n + t.n, 0)
      const rating = m ? ratingRows.find((r) => r.steamId === f.steamId && r.mode === m.mode)?.rating : undefined
      return {
        id: f.id,
        status: statusView(f.status),
        source: f.source,
        createdAt: f.createdAt.toISOString(),
        decidedAt: iso(f.decidedAt ?? f.resolvedAt),
        reviewer: f.reviewerSteamId ? cardOf(cards, f.reviewerSteamId) : null,
        note: f.note,
        player: {
          ...cardOf(cards, f.steamId),
          trustLevel: (trust[f.steamId] ?? "new") as TrustLevel,
          banned: banned.has(f.steamId),
          stats: {
            matches: stat?.matches ?? 0,
            wins: stat?.wins ?? 0,
            kills,
            deaths,
            headshots,
            kd: deaths > 0 ? round2(kills / deaths) : kills > 0 ? kills : null,
            headshotPct: kills > 0 ? round2(headshots / kills) : null,
            rating: rating === undefined ? null : Math.round(rating),
          },
          history: {
            reportsReceived: reportTotals.find((t) => t.steamId === f.steamId)?.n ?? 0,
            flagsConfirmed: flagCount(["confirmed"]),
            flagsCleared: flagCount(["cleared", "dismissed"]),
          },
        },
        match: m ? matchView(m, playerRows, cards, f.steamId) : null,
        reports: reportRows
          .filter((r) => r.reportedSteamId === f.steamId && r.matchId === f.matchId)
          .map((r) => ({
            id: r.id,
            reporter: { ...cardOf(cards, r.reporterSteamId), trustLevel: (trust[r.reporterSteamId] ?? "new") as TrustLevel },
            reason: r.reason as ReportReason,
            note: r.detail,
            outcome: r.outcome,
            createdAt: r.createdAt.toISOString(),
          })),
      }
    })
  }
}

function outcomeFor(status: FlagRow["status"]): ReportOutcome {
  if (status === "confirmed") return "actioned"
  if (status === "cleared" || status === "dismissed") return "dismissed"
  if (status === "reviewing") return "reviewed"
  return "received"
}

function rollbackView(r: { voidedMatches: string[]; players: unknown[] }) {
  return { voidedMatches: r.voidedMatches.length, playersAdjusted: r.players.length }
}

const round2 = (n: number) => Math.round(n * 100) / 100

function cardOf(cards: Map<string, Card>, steamId: string): Card {
  const c = cards.get(steamId)
  return { steamId, displayName: c?.displayName ?? steamId, avatarUrl: c?.avatarUrl ?? null }
}

function matchView(
  m: typeof matches.$inferSelect,
  players: (typeof matchPlayers.$inferSelect)[],
  cards: Map<string, Card>,
  flagged: string,
): ReviewMatch {
  const scores = teamScores(m.teams, m.score)
  const own = players.filter((p) => p.matchId === m.id)
  const flaggedTeam = own.find((p) => p.steamId === flagged)?.team ?? null
  return {
    id: m.id,
    mode: m.mode,
    mapId: m.mapId,
    status: m.status as MatchStatus,
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    flaggedTeam,
    teams: m.teams.map((t, idx) => ({
      name: t.name,
      score: scores[idx]?.score ?? 0,
      players: own
        .filter((p) => p.team === idx)
        .map((p) => ({
          ...cardOf(cards, p.steamId),
          kills: p.kills,
          deaths: p.deaths,
          headshots: p.headshots,
          damage: p.damage,
        })),
    })),
  }
}
