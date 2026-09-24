import {
  CHAT_GLOBAL_CHANNEL,
  CHAT_HISTORY_LIMIT,
  CHAT_RATE,
  tierForRating,
  type ChatAuthor,
  type ChatChannel,
  type ChatMessage,
  type ChatMuteStatus,
  type ChatMuteView,
} from "@rushsite/shared"
import { and, desc, eq, gt, inArray, isNull, lt, max, or } from "drizzle-orm"
import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { ratings, trustLevels, users } from "../../db/schema.js"
import { ApiError } from "../../lib/errors.js"
import type { Audience, Notifier } from "../ws/hub.js"
import { chatMessages, chatMutes } from "./schema.js"

type MessageRow = typeof chatMessages.$inferSelect
type MuteRow = typeof chatMutes.$inferSelect

export type ChatDeps = {
  db: Db
  redis: Redis
  notifier: Notifier
  isAdmin: (steamId: string) => boolean
  now: () => number
  rate?: { max: number; windowSec: number }
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
  private readonly rate: { max: number; windowSec: number }

  constructor(private readonly deps: ChatDeps) {
    this.rate = deps.rate ?? CHAT_RATE
  }

  // Newest limit messages before the cursor, returned oldest first
  async history(channel: ChatChannel, opts: { before?: Date; limit?: number } = {}): Promise<ChatMessage[]> {
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
    return this.views(rows.reverse())
  }

  async post(steamId: string, channel: ChatChannel, body: string): Promise<ChatMessage> {
    const muted = await this.activeMute(steamId)
    if (muted) throw new ApiError(403, "chat_muted", "You are muted in chat", muted)
    await this.checkRate(steamId)
    const [row] = await this.deps.db
      .insert(chatMessages)
      .values({ channel, steamId, body, createdAt: new Date(this.deps.now()) })
      .returning()
    const [message] = await this.views([row!])
    this.deps.notifier.send(audienceOf(channel), { type: "chat_message", payload: message, ts: this.deps.now() })
    return message!
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
    return { id: row.id, channel: row.channel, steamId: row.steamId, body: row.body }
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

  // Fixed window counter in Redis so every instance shares the limit
  private async checkRate(steamId: string): Promise<void> {
    const windowMs = this.rate.windowSec * 1000
    const t = this.deps.now()
    const slot = Math.floor(t / windowMs)
    const key = `chat:rl:${steamId}:${slot}`
    const count = await this.deps.redis.incr(key)
    if (count === 1) await this.deps.redis.pexpire(key, windowMs * 2)
    if (count > this.rate.max) {
      const retryAfterSec = Math.max(1, Math.ceil(((slot + 1) * windowMs - t) / 1000))
      throw new ApiError(429, "chat_rate_limited", `Slow down. Try again in ${retryAfterSec}s`, { retryAfterSec })
    }
  }

  private async views(rows: MessageRow[]): Promise<ChatMessage[]> {
    const authors = await this.authors([...new Set(rows.map((r) => r.steamId))])
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      author: authors.get(r.steamId) ?? this.fallbackAuthor(r.steamId),
      body: r.body,
      createdAt: r.createdAt.toISOString(),
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
