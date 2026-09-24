import {
  CHAT_GLOBAL_CHANNEL,
  CHAT_HISTORY_LIMIT,
  CHAT_LIMITS,
  CHAT_SLOW_MODE_DEFAULT_SEC,
  tierForRating,
  type FeatureFlag,
  type ChatAuthor,
  type ChatChannel,
  type ChatMessage,
  type ChatMuteStatus,
  type ChatMuteView,
} from "@rushsite/shared"
import { and, desc, eq, gt, inArray, isNull, lt, max, or } from "drizzle-orm"
import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { adminAudit, ratings, trustLevels, users } from "../../db/schema.js"
import { ApiError } from "../../lib/errors.js"
import type { Audience, Notifier } from "../ws/hub.js"
import { filterMessage } from "./filter.js"
import { ChatGuard, type ChatLimits } from "./guard.js"
import { chatMessages, chatMutes } from "./schema.js"

type MessageRow = typeof chatMessages.$inferSelect
type MuteRow = typeof chatMutes.$inferSelect

export type ChatDeps = {
  db: Db
  redis: Redis
  notifier: Notifier
  isAdmin: (steamId: string) => boolean
  now: () => number
  limits?: ChatLimits
  // Seconds between posts while the global slow mode is on. 0 is off
  slowModeSec?: () => Promise<number>
}

// Audit rows written by the filter use this in place of an admin id
export const SYSTEM_ACTOR = "system"

// Reads the slow mode flag. The value may be a number or { seconds }
export function slowModeSeconds(flag: FeatureFlag | null): number {
  if (!flag?.enabled) return 0
  const v = flag.value as { seconds?: unknown } | number | null | undefined
  const sec = typeof v === "number" ? v : typeof v === "object" && v && typeof v.seconds === "number" ? v.seconds : CHAT_SLOW_MODE_DEFAULT_SEC
  return Math.max(0, Math.min(Math.round(sec), 3600))
}

// Who receives live messages of a channel
export function audienceOf(channel: ChatChannel): Audience {
  if (channel === CHAT_GLOBAL_CHANNEL) return { kind: "broadcast" }
  return { kind: "match", matchId: channel.slice("match:".length) }
}

function muteStatus(row: MuteRow): ChatMuteStatus {
  return { until: row.until ? row.until.toISOString() : null, reason: row.reason }
}

export class ChatService {
  private readonly guard: ChatGuard

  constructor(private readonly deps: ChatDeps) {
    this.guard = new ChatGuard(deps.redis, deps.now, deps.limits ?? CHAT_LIMITS)
  }

  async slowModeSec(): Promise<number> {
    return (await this.deps.slowModeSec?.().catch(() => 0)) ?? 0
  }

  // Newest limit messages before the cursor, returned oldest first
  // Admins also get the text before masking
  async history(channel: ChatChannel, opts: { before?: Date; limit?: number; withOriginal?: boolean } = {}): Promise<ChatMessage[]> {
    const limit = Math.min(Math.max(opts.limit ?? CHAT_HISTORY_LIMIT, 1), CHAT_HISTORY_LIMIT)
    const rows = await this.deps.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.channel, channel),
          isNull(chatMessages.deletedAt),
          opts.before ? lt(chatMessages.createdAt, opts.before) : undefined,
        ),
      )
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(limit)
    return this.views(rows.reverse(), opts.withOriginal ?? false)
  }

  // Order matters. Waits and the rate counter run before the filter so refused posts still use up the budget
  async post(steamId: string, channel: ChatChannel, body: string): Promise<ChatMessage> {
    const muted = await this.activeMute(steamId)
    if (muted) throw new ApiError(403, "chat_muted", "You are muted in chat", muted)
    const slow = this.deps.isAdmin(steamId) ? 0 : await this.slowModeSec()
    await this.guard.checkWait(steamId, slow)
    await this.guard.countAttempt(steamId)
    const verdict = filterMessage(body)
    if (!verdict.ok) {
      await this.logRefusal(steamId, channel, body, verdict.code, verdict.rule)
      throw new ApiError(400, verdict.code, verdict.message)
    }
    await this.guard.checkDuplicate(steamId, body)
    const [row] = await this.deps.db
      .insert(chatMessages)
      .values({
        channel,
        steamId,
        body: verdict.body,
        originalBody: verdict.masked ? body : null,
        createdAt: new Date(this.deps.now()),
      })
      .returning()
    await this.guard.accepted(steamId, body, slow)
    const [message] = await this.views([row!], false)
    this.deps.notifier.send(audienceOf(channel), { type: "chat_message", payload: message, ts: this.deps.now() })
    return message!
  }

  // Written like an admin action so it shows on the user's admin page, and pushed to live admins
  private async logRefusal(steamId: string, channel: ChatChannel, body: string, code: string, rule: string): Promise<void> {
    try {
      await this.deps.db
        .insert(adminAudit)
        .values({ adminSteamId: SYSTEM_ACTOR, action: "chat.refused", target: steamId, payload: { code, rule, channel, body } })
    } catch {
      // Logging must never turn a refusal into a 500
    }
    this.deps.notifier.send(
      { kind: "admins" },
      { type: "admin_event", payload: { kind: "user", payload: { action: "chat_refused", steamId, code, rule } }, ts: this.deps.now() },
    )
  }

  // Soft deletes and tells live viewers. Null when the message is missing or already gone
  async remove(id: string, by: string): Promise<{ id: string; channel: ChatChannel; steamId: string; body: string } | null> {
    const [row] = await this.deps.db
      .update(chatMessages)
      .set({ deletedAt: new Date(this.deps.now()), deletedBy: by })
      .where(and(eq(chatMessages.id, id), isNull(chatMessages.deletedAt)))
      .returning()
    if (!row) return null
    this.deps.notifier.send(audienceOf(row.channel), {
      type: "chat_deleted",
      payload: { id: row.id, channel: row.channel },
      ts: this.deps.now(),
    })
    return { id: row.id, channel: row.channel, steamId: row.steamId, body: row.originalBody ?? row.body }
  }

  async activeMute(steamId: string): Promise<ChatMuteStatus | null> {
    const [row] = await this.deps.db
      .select()
      .from(chatMutes)
      .where(and(eq(chatMutes.steamId, steamId), or(isNull(chatMutes.until), gt(chatMutes.until, new Date(this.deps.now())))))
      .limit(1)
    return row ? muteStatus(row) : null
  }

  // Replaces any earlier mute. Null until is permanent
  async mute(steamId: string, until: Date | null, reason: string, by: string): Promise<ChatMuteStatus> {
    const values = { steamId, until, reason, mutedBy: by, createdAt: new Date(this.deps.now()) }
    const [row] = await this.deps.db
      .insert(chatMutes)
      .values(values)
      .onConflictDoUpdate({ target: chatMutes.steamId, set: { until, reason, mutedBy: by, createdAt: values.createdAt } })
      .returning()
    return muteStatus(row!)
  }

  // False when the user had no active mute
  async unmute(steamId: string): Promise<boolean> {
    const active = await this.activeMute(steamId)
    await this.deps.db.delete(chatMutes).where(eq(chatMutes.steamId, steamId))
    return active !== null
  }

  async mutes(): Promise<ChatMuteView[]> {
    const rows = await this.deps.db
      .select({ mute: chatMutes, displayName: users.displayName })
      .from(chatMutes)
      .leftJoin(users, eq(users.steamId, chatMutes.steamId))
      .where(or(isNull(chatMutes.until), gt(chatMutes.until, new Date(this.deps.now()))))
      .orderBy(desc(chatMutes.createdAt))
    return rows.map(({ mute, displayName }) => ({
      steamId: mute.steamId,
      displayName: displayName ?? mute.steamId,
      ...muteStatus(mute),
      mutedBy: mute.mutedBy,
      createdAt: mute.createdAt.toISOString(),
    }))
  }

  private async views(rows: MessageRow[], withOriginal: boolean): Promise<ChatMessage[]> {
    const authors = await this.authors([...new Set(rows.map((r) => r.steamId))])
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      author: authors.get(r.steamId) ?? this.fallbackAuthor(r.steamId),
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      ...(withOriginal && r.originalBody ? { originalBody: r.originalBody } : {}),
    }))
  }

  private fallbackAuthor(steamId: string): ChatAuthor {
    return { steamId, displayName: steamId, avatarUrl: null, trustLevel: "new", tier: "unranked", admin: this.deps.isAdmin(steamId) }
  }

  private async authors(ids: string[]): Promise<Map<string, ChatAuthor>> {
    const out = new Map<string, ChatAuthor>()
    if (ids.length === 0) return out
    const { db } = this.deps
    const [cards, levels, best] = await Promise.all([
      db
        .select({ steamId: users.steamId, displayName: users.displayName, avatarUrl: users.avatarUrl })
        .from(users)
        .where(inArray(users.steamId, ids)),
      db.select({ steamId: trustLevels.steamId, level: trustLevels.level }).from(trustLevels).where(inArray(trustLevels.steamId, ids)),
      db
        .select({ steamId: ratings.steamId, rating: max(ratings.rating) })
        .from(ratings)
        .where(and(inArray(ratings.steamId, ids), gt(ratings.matchesPlayed, 0)))
        .groupBy(ratings.steamId),
    ])
    const levelOf = new Map(levels.map((l) => [l.steamId, l.level]))
    const ratingOf = new Map(best.map((b) => [b.steamId, b.rating]))
    for (const c of cards) {
      const rating = ratingOf.get(c.steamId)
      out.set(c.steamId, {
        ...c,
        trustLevel: levelOf.get(c.steamId) ?? "new",
        tier: rating === undefined || rating === null ? "unranked" : tierForRating(rating).id,
        admin: this.deps.isAdmin(c.steamId),
      })
    }
    return out
  }
}
