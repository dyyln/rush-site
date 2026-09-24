import { CHAT_LIMITS } from "@rushsite/shared"
import type { Redis } from "ioredis"
import { ApiError } from "../../lib/errors.js"
import { fingerprint, similarity } from "./filter.js"

export type ChatLimits = {
  rate: { max: number; windowSec: number }
  cooldownStepsSec: readonly number[]
  strikeResetSec: number
  duplicateWindowSec: number
  duplicateSimilarity: number
}

// How many recent messages the duplicate guard compares against
const RECENT_KEEP = 5

const tooFast = (code: string, message: string, retryAfterSec: number) =>
  new ApiError(429, code, message, { retryAfterSec })

// Posting limits kept in Redis so every api instance shares them
export class ChatGuard {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number,
    private readonly limits: ChatLimits = CHAT_LIMITS,
  ) {}

  // The value holds the end time from our clock. The Redis ttl only cleans up
  private async remainingSec(key: string): Promise<number> {
    const until = Number(await this.redis.get(key))
    const ms = until - this.now()
    return ms > 0 ? Math.ceil(ms / 1000) : 0
  }

  private async hold(key: string, sec: number): Promise<void> {
    await this.redis.set(key, String(this.now() + sec * 1000), "PX", sec * 1000)
  }

  // Throws while a cooldown or the global slow mode holds the user back
  async checkWait(steamId: string, slowModeSec: number): Promise<void> {
    const cooldown = await this.remainingSec(`chat:cd:${steamId}`)
    if (cooldown > 0) throw tooFast("chat_rate_limited", `You are sending messages too fast. Wait ${cooldown}s`, cooldown)
    if (slowModeSec > 0) {
      const slow = await this.remainingSec(`chat:slow:${steamId}`)
      if (slow > 0) throw tooFast("chat_slow_mode", `Slow mode is on. Wait ${slow}s`, slow)
    }
  }

  // Counts one attempt. Going over the window starts a cooldown that grows on each repeat
  async countAttempt(steamId: string): Promise<void> {
    const { rate, cooldownStepsSec, strikeResetSec } = this.limits
    const windowMs = rate.windowSec * 1000
    const slot = Math.floor(this.now() / windowMs)
    const key = `chat:rl:${steamId}:${slot}`
    const count = await this.redis.incr(key)
    if (count === 1) await this.redis.pexpire(key, windowMs * 2)
    if (count <= rate.max) return
    const strikes = await this.redis.incr(`chat:strikes:${steamId}`)
    await this.redis.expire(`chat:strikes:${steamId}`, strikeResetSec)
    const step = cooldownStepsSec[Math.min(strikes, cooldownStepsSec.length) - 1]!
    await this.hold(`chat:cd:${steamId}`, step)
    throw tooFast("chat_rate_limited", `You are sending messages too fast. Wait ${step}s`, step)
  }

  // Refuses the same or nearly the same text sent inside the duplicate window
  async checkDuplicate(steamId: string, text: string): Promise<void> {
    const f = fingerprint(text)
    if (!f) return
    const windowMs = this.limits.duplicateWindowSec * 1000
    const t = this.now()
    for (const raw of await this.redis.lrange(`chat:recent:${steamId}`, 0, RECENT_KEEP - 1)) {
      const prev = JSON.parse(raw) as { t: number; f: string }
      const age = t - prev.t
      if (age < 0 || age >= windowMs) continue
      if (similarity(f, prev.f) >= this.limits.duplicateSimilarity) {
        const wait = Math.max(1, Math.ceil((windowMs - age) / 1000))
        throw tooFast("chat_duplicate", `You just said that. Wait ${wait}s or say something new`, wait)
      }
    }
  }

  // Remembers an accepted message for the duplicate guard and starts the slow mode wait
  async accepted(steamId: string, text: string, slowModeSec: number): Promise<void> {
    const key = `chat:recent:${steamId}`
    await this.redis
      .multi()
      .lpush(key, JSON.stringify({ t: this.now(), f: fingerprint(text) }))
      .ltrim(key, 0, RECENT_KEEP - 1)
      .pexpire(key, this.limits.duplicateWindowSec * 1000)
      .exec()
    if (slowModeSec > 0) await this.hold(`chat:slow:${steamId}`, slowModeSec)
  }
}
