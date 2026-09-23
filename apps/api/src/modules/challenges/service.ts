import { randomBytes } from "node:crypto"
import {
  CHALLENGE_TTL_SEC,
  getModeConfig,
  unresolvedConfig,
  type Challenge,
  type ChallengeStatus,
  type ChallengeUpdatePayload,
  type CreateChallengeBody,
  type Mode,
} from "@rushsite/shared"
import { and, desc, eq, gt, lte, or, sql } from "drizzle-orm"
import type { AppContext } from "../../context.js"
import { matches } from "../../db/schema.js"
import { ApiError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js"
import { withLock } from "../../lib/redis.js"
import { toUsers } from "../ws/hub.js"
import { challenges } from "./schema.js"

type Row = typeof challenges.$inferSelect

// Open challenges one player may have at a time
export const MAX_OPEN_CHALLENGES = 5

// No 0, O, 1, I or L so codes survive being read aloud
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
const CODE_LENGTH = 8

export function newCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ""
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

// Direct challenges and rematches. A challenge turns into a match that skips queue and accept
export class ChallengeService {
  constructor(private readonly ctx: AppContext) {}

  private now(): Date {
    return new Date(this.ctx.now())
  }

  url(code: string): string {
    return `${this.ctx.env.PUBLIC_URL.replace(/\/+$/, "")}/challenge/${code}`
  }

  private allowUnresolved(): boolean {
    return this.ctx.env.NODE_ENV !== "production" && this.ctx.env.ALLOW_UNRESOLVED_MODES
  }

  private assertModeAvailable(mode: Mode): void {
    if (!this.allowUnresolved() && unresolvedConfig(mode).length > 0) {
      throw new ApiError(503, "mode_unavailable", `${mode} is not configured yet`)
    }
  }

  async views(rows: Row[]): Promise<Challenge[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.createdBy, r.targetSteamId].filter((x): x is string => !!x)))]
    const cards = await this.ctx.users.cards(ids)
    const card = (id: string) => ({
      steamId: id,
      displayName: cards.get(id)?.displayName ?? id,
      avatarUrl: cards.get(id)?.avatarUrl ?? null,
    })
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      mode: r.mode,
      status: r.status,
      createdBy: card(r.createdBy),
      target: r.targetSteamId ? card(r.targetSteamId) : null,
      rematchOfMatchId: r.rematchOfMatchId,
      matchId: r.matchId,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }))
  }

  async view(row: Row): Promise<Challenge> {
    return (await this.views([row]))[0]!
  }

  private async notify(row: Row, extra: string[] = []): Promise<Challenge> {
    const challenge = await this.view(row)
    const to = [...new Set([row.createdBy, ...(row.targetSteamId ? [row.targetSteamId] : []), ...extra])]
    const payload: ChallengeUpdatePayload = { challenge }
    toUsers(this.ctx.notifier, to, "challenge_update", payload)
    return challenge
  }

  private async setStatus(row: Row, status: ChallengeStatus, extra: Partial<Row> = {}): Promise<Row | null> {
    const [next] = await this.ctx.db
      .update(challenges)
      .set({ ...extra, status, updatedAt: this.now() })
      .where(and(eq(challenges.id, row.id), eq(challenges.status, "open")))
      .returning()
    return next ?? null
  }

  private async load(code: string): Promise<Row> {
    const [row] = await this.ctx.db.select().from(challenges).where(eq(challenges.code, code.toUpperCase()))
    if (!row) throw notFound("challenge_not_found")
    return this.expireIfDue(row)
  }

  // Expires one open challenge on read so a slow tick never lets a stale one through
  private async expireIfDue(row: Row): Promise<Row> {
    if (row.status !== "open" || row.expiresAt.getTime() > this.ctx.now()) return row
    const next = await this.setStatus(row, "expired")
    if (!next) {
      const [fresh] = await this.ctx.db.select().from(challenges).where(eq(challenges.id, row.id))
      return fresh ?? row
    }
    await this.notify(next)
    return next
  }

  // Players on one side of a challenge match. Team modes take the whole party, led by steamId
  private async side(steamId: string, mode: Mode, expected?: string[]): Promise<string[]> {
    const size = getModeConfig(mode).teamSize
    if (size === 1) return [steamId]
    const party = await this.ctx.parties.partyOf(steamId)
    const members = party?.memberSteamIds ?? [steamId]
    if (party && party.leaderSteamId !== steamId) throw forbidden("not_leader", "only the party leader can do this")
    if (members.length !== size) throw conflict("party_size", `${mode} needs a party of ${size}`)
    if (expected && !sameSet(members, expected)) {
      throw conflict("roster_changed", "a rematch needs the same players as the original match")
    }
    return members
  }

  private async finishedMatch(matchId: string, steamId: string) {
    const [m] = await this.ctx.db.select().from(matches).where(eq(matches.id, matchId))
    if (!m) throw notFound("match_not_found")
    const mine = m.teams.findIndex((t) => t.steamIds.includes(steamId))
    if (mine < 0) throw forbidden("not_in_match", "only players from the match can ask for a rematch")
    if (m.status !== "finished") throw conflict("match_not_finished")
    return { m, mine, own: m.teams[mine]!.steamIds, opp: m.teams[mine === 0 ? 1 : 0]!.steamIds }
  }

  // Leader of a party that is exactly the given roster, or null
  private async leaderOf(roster: string[]): Promise<string | null> {
    if (roster.length === 1) return roster[0]!
    for (const id of roster) {
      const p = await this.ctx.parties.partyOf(id)
      if (p && sameSet(p.memberSteamIds, roster)) return p.leaderSteamId
    }
    return null
  }

  async create(steamId: string, body: CreateChallengeBody): Promise<{ challenge: Challenge; url: string }> {
    const { mode } = body
    this.assertModeAvailable(mode)
    if ((await this.ctx.trust.activeBans([steamId])).size > 0) throw forbidden("banned")
    const nowDate = this.now()
    let target: string | null = body.targetSteamId ?? null

    if (body.rematchOfMatchId) {
      const r = await this.finishedMatch(body.rematchOfMatchId, steamId)
      if (r.m.mode !== mode) throw badRequest("mode_mismatch", "a rematch is played in the same mode")
      // One open rematch per match. Whoever asks second gets the existing one back and can accept it
      const [existing] = await this.ctx.db
        .select()
        .from(challenges)
        .where(and(eq(challenges.rematchOfMatchId, r.m.id), eq(challenges.status, "open"), gt(challenges.expiresAt, nowDate)))
        .limit(1)
      if (existing) return { challenge: await this.view(existing), url: this.url(existing.code) }
      await this.side(steamId, mode, r.own)
      const oppLeader = await this.leaderOf(r.opp)
      if (!oppLeader) throw conflict("opponents_split", "the other team is no longer in one party")
      if (target && target !== oppLeader) throw badRequest("target_mismatch", "a rematch targets the other team")
      target = oppLeader
    } else {
      if (target === steamId) throw badRequest("self_challenge", "you cannot challenge yourself")
      if (target && !(await this.ctx.users.card(target))) throw notFound("user_not_found")
      await this.side(steamId, mode)
      // Asking again for the same opponent and mode returns the open challenge
      if (target) {
        const [dup] = await this.ctx.db
          .select()
          .from(challenges)
          .where(
            and(
              eq(challenges.createdBy, steamId),
              eq(challenges.targetSteamId, target),
              eq(challenges.mode, mode),
              eq(challenges.status, "open"),
              gt(challenges.expiresAt, nowDate),
              sql`${challenges.rematchOfMatchId} is null`,
            ),
          )
          .limit(1)
        if (dup) return { challenge: await this.view(dup), url: this.url(dup.code) }
      }
    }

    const [{ n } = { n: 0 }] = await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(challenges)
      .where(and(eq(challenges.createdBy, steamId), eq(challenges.status, "open"), gt(challenges.expiresAt, nowDate)))
    if (n >= MAX_OPEN_CHALLENGES) throw conflict("too_many_challenges", `at most ${MAX_OPEN_CHALLENGES} open challenges`)

    let row: Row | undefined
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      ;[row] = await this.ctx.db
        .insert(challenges)
        .values({
          mode,
          createdBy: steamId,
          targetSteamId: target,
          rematchOfMatchId: body.rematchOfMatchId ?? null,
          code: newCode(),
          status: "open",
          expiresAt: new Date(nowDate.getTime() + CHALLENGE_TTL_SEC * 1000),
          createdAt: nowDate,
          updatedAt: nowDate,
        })
        .onConflictDoNothing({ target: challenges.code })
        .returning()
    }
    if (!row) throw new Error("could not allocate a challenge code")
    const challenge = await this.notify(row)
    return { challenge, url: this.url(row.code) }
  }

  async get(code: string): Promise<Challenge> {
    return this.view(await this.load(code))
  }

  async accept(steamId: string, code: string): Promise<Challenge> {
    const out = await withLock(this.ctx.redis, `lock:challenge:${code.toUpperCase()}`, 30_000, () => this.acceptLocked(steamId, code))
    if (!out) throw conflict("challenge_busy", "the challenge is being answered, try again")
    return out
  }

  private async acceptLocked(steamId: string, code: string): Promise<Challenge> {
    const row = await this.load(code)
    if (row.status !== "open") throw conflict(`challenge_${row.status}`)
    if (row.createdBy === steamId) throw badRequest("own_challenge", "you cannot accept your own challenge")
    if (row.targetSteamId && row.targetSteamId !== steamId) throw forbidden("not_target", "this challenge is for someone else")
    this.assertModeAvailable(row.mode)
    if (!(await this.ctx.flags.queueOpen(row.mode))) throw conflict("mode_closed", `${row.mode} is closed right now`)

    let expectCreator: string[] | undefined
    let expectAccepter: string[] | undefined
    if (row.rematchOfMatchId) {
      const r = await this.finishedMatch(row.rematchOfMatchId, row.createdBy)
      if (!r.opp.includes(steamId)) throw forbidden("not_target", "this rematch is for the other team")
      expectCreator = r.own
      expectAccepter = r.opp
    }
    const home = await this.side(row.createdBy, row.mode, expectCreator)
    const away = await this.side(steamId, row.mode, expectAccepter)
    if (home.some((id) => away.includes(id))) throw conflict("same_party", "both sides share a player")
    const everyone = [...home, ...away]

    if ((await this.ctx.trust.activeBans(everyone)).size > 0) throw forbidden("banned", "a player is banned")
    if ((await this.ctx.cooldowns.active(everyone)).size > 0) throw conflict("cooldown", "a player is on cooldown")
    if ((await this.ctx.queue.inActiveMatch(everyone)).length > 0) throw conflict("in_match", "a player is already in a match")

    // Both parties leave any queue they were in
    const partyIds = new Set<string>()
    for (const id of everyone) {
      const p = await this.ctx.parties.partyOf(id)
      if (p) partyIds.add(p.partyId)
    }
    for (const partyId of partyIds) await this.ctx.queue.cancelParty(partyId, "challenge_accepted")

    let matchId: string
    try {
      ;({ matchId } = await this.ctx.flow.createDirectMatch({
        mode: row.mode,
        teams: [
          { name: "A", steamIds: home },
          { name: "B", steamIds: away },
        ],
      }))
    } catch (err) {
      if (/not configured/.test((err as Error).message)) throw new ApiError(503, "mode_unavailable")
      throw err
    }
    const next = await this.setStatus(row, "accepted", { matchId, targetSteamId: steamId })
    if (!next) throw conflict("challenge_changed")
    return this.notify(next, everyone)
  }

  // The target declines. The creator declining withdraws the challenge
  async decline(steamId: string, code: string): Promise<Challenge> {
    const row = await this.load(code)
    if (row.status !== "open") throw conflict(`challenge_${row.status}`)
    let status: ChallengeStatus
    if (row.createdBy === steamId) status = "cancelled"
    else if (row.targetSteamId === steamId) status = "declined"
    else throw forbidden("not_target", "only the challenged player can decline")
    const next = await this.setStatus(row, status)
    if (!next) throw conflict("challenge_changed")
    return this.notify(next)
  }

  // Open challenges the player sent or received, newest first
  async mine(steamId: string): Promise<Challenge[]> {
    const rows = await this.ctx.db
      .select()
      .from(challenges)
      .where(
        and(
          eq(challenges.status, "open"),
          gt(challenges.expiresAt, this.now()),
          or(eq(challenges.createdBy, steamId), eq(challenges.targetSteamId, steamId)),
        ),
      )
      .orderBy(desc(challenges.createdAt))
      .limit(50)
    return this.views(rows)
  }

  // Marks every overdue open challenge expired and tells both players. Safe to run on every instance
  async expireDue(): Promise<number> {
    const rows = await this.ctx.db
      .update(challenges)
      .set({ status: "expired", updatedAt: this.now() })
      .where(and(eq(challenges.status, "open"), lte(challenges.expiresAt, this.now())))
      .returning()
    for (const row of rows) await this.notify(row)
    return rows.length
  }
}
