import type { Redis } from "ioredis"
import type { WsEnvelope } from "@rushsite/shared"

export type Outgoing = WsEnvelope
export type Audience =
  | { kind: "users"; steamIds: string[] }
  | { kind: "broadcast" }
  | { kind: "admins" }
  | { kind: "match"; matchId: string }

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
export const MAX_MATCH_SUBSCRIPTIONS = 20

// Sockets connected to this process
export class LocalHub {
  private readonly byUser = new Map<string, Set<SocketLike>>()
  private readonly admins = new Set<SocketLike>()
  private readonly matchSubs = new Map<string, Set<SocketLike>>()
  private readonly socketMatches = new Map<SocketLike, Set<string>>()

  // Returns false when the socket already follows the maximum number of matches
  subscribeMatch(socket: SocketLike, matchId: string): boolean {
    const mine = this.socketMatches.get(socket) ?? new Set<string>()
    if (!mine.has(matchId) && mine.size >= MAX_MATCH_SUBSCRIPTIONS) return false
    mine.add(matchId)
    this.socketMatches.set(socket, mine)
    const subs = this.matchSubs.get(matchId) ?? new Set<SocketLike>()
    subs.add(socket)
    this.matchSubs.set(matchId, subs)
    return true
  }

  unsubscribeMatch(socket: SocketLike, matchId: string): void {
    this.socketMatches.get(socket)?.delete(matchId)
    const subs = this.matchSubs.get(matchId)
    if (!subs) return
    subs.delete(socket)
    if (subs.size === 0) this.matchSubs.delete(matchId)
  }

  // Drops every match subscription of a closed socket
  dropSocket(socket: SocketLike): void {
    for (const id of this.socketMatches.get(socket) ?? []) this.unsubscribeMatch(socket, id)
    this.socketMatches.delete(socket)
  }

  add(steamId: string, socket: SocketLike, isAdmin = false): void {
    if (isAdmin) this.admins.add(socket)
    let set = this.byUser.get(steamId)
    if (!set) {
      set = new Set()
      this.byUser.set(steamId, set)
    }
    set.add(socket)
  }

  remove(steamId: string, socket: SocketLike): void {
    this.admins.delete(socket)
    this.dropSocket(socket)
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
        : audience.kind === "admins"
          ? [this.admins]
          : audience.kind === "match"
            ? [this.matchSubs.get(audience.matchId) ?? new Set<SocketLike>()]
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
