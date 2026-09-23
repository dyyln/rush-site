import { randomUUID } from "node:crypto"
import type { Redis } from "ioredis"
import type { AdminEventKind } from "@rushsite/shared"
import type { Notifier } from "../modules/ws/hub.js"

export type RecordedEvent = {
  id: string
  kind: "webhook" | "error"
  at: string
  type: string
  message: string
  matchId?: string | null
  ok?: boolean
  detail?: unknown
}

const KEY = "admin:events"
const MAX = 500

// Ring buffer of recent webhooks and errors for the admin console, plus live admin_event pushes
export class EventLog {
  constructor(
    private readonly redis: Redis,
    private readonly notifier?: Notifier,
  ) {}

  record(e: Omit<RecordedEvent, "id" | "at">): void {
    const entry: RecordedEvent = { id: randomUUID(), at: new Date().toISOString(), ...e }
    void this.redis
      .multi()
      .lpush(KEY, JSON.stringify(entry))
      .ltrim(KEY, 0, MAX - 1)
      .exec()
      .catch(() => undefined)
    this.emit(e.kind, entry)
  }

  // Sends an admin_event to connected admins only
  emit(kind: AdminEventKind, payload: unknown): void {
    this.notifier?.send({ kind: "admins" }, { type: "admin_event", payload: { kind, payload }, ts: Date.now() })
  }

  async recent(limit = 100): Promise<RecordedEvent[]> {
    const rows = await this.redis.lrange(KEY, 0, Math.max(0, Math.min(limit, MAX) - 1))
    return rows.map((r) => JSON.parse(r) as RecordedEvent)
  }
}
