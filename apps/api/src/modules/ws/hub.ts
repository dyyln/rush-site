import type { Redis } from "ioredis"
import type { WsEnvelope } from "@rushsite/shared"

export type Outgoing = WsEnvelope
export type Audience = { kind: "users"; steamIds: string[] } | { kind: "broadcast" }

// Anything services use to push messages to connected players
export interface Notifier {
  send(audience: Audience, msg: Outgoing): void
}

export function toUsers(notifier: Notifier, steamIds: string[], type: string, payload: unknown, ts = Date.now()): void {
  if (steamIds.length === 0) return
  notifier.send({ kind: "users", steamIds }, { type, payload, ts })
}

export interface SocketLike {
  readonly readyState: number
  send(data: string): void
}

const OPEN = 1

// Sockets connected to this process
export class LocalHub {
  private readonly byUser = new Map<string, Set<SocketLike>>()

  add(steamId: string, socket: SocketLike): void {
    let set = this.byUser.get(steamId)
    if (!set) {
      set = new Set()
      this.byUser.set(steamId, set)
    }
    set.add(socket)
  }

  remove(steamId: string, socket: SocketLike): void {
    const set = this.byUser.get(steamId)
    if (!set) return
    set.delete(socket)
    if (set.size === 0) this.byUser.delete(steamId)
  }

  deliver(audience: Audience, msg: Outgoing): void {
    const data = JSON.stringify(msg)
    const targets =
      audience.kind === "broadcast"
        ? [...this.byUser.values()]
        : audience.steamIds.map((id) => this.byUser.get(id)).filter((s): s is Set<SocketLike> => !!s)
    for (const set of targets) {
      for (const socket of set) {
        if (socket.readyState === OPEN) socket.send(data)
      }
    }
  }

  connectedUsers(): number {
    return this.byUser.size
  }
}

export const WS_CHANNEL = "rs:ws"

// Publishes to Redis so every API instance delivers to its own sockets
export class RedisNotifier implements Notifier {
  constructor(private readonly pub: Redis) {}

  send(audience: Audience, msg: Outgoing): void {
    void this.pub.publish(WS_CHANNEL, JSON.stringify({ audience, msg })).catch(() => undefined)
  }
}

export async function subscribeFanout(sub: Redis, hub: LocalHub): Promise<void> {
  await sub.subscribe(WS_CHANNEL)
  sub.on("message", (channel: string, raw: string) => {
    if (channel !== WS_CHANNEL) return
    try {
      const { audience, msg } = JSON.parse(raw) as { audience: Audience; msg: Outgoing }
      hub.deliver(audience, msg)
    } catch {
      // Ignore malformed messages
    }
  })
}

// Test double that records every message
export class MemoryNotifier implements Notifier {
  readonly sent: { audience: Audience; msg: Outgoing }[] = []

  send(audience: Audience, msg: Outgoing): void {
    this.sent.push({ audience, msg })
  }

  ofType(type: string): { audience: Audience; msg: Outgoing }[] {
    return this.sent.filter((s) => s.msg.type === type)
  }

  clear(): void {
    this.sent.length = 0
  }
}
