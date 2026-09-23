import type { Redis } from "ioredis"
import type { WsEnvelope } from "@rushsite/shared"
import { sendChecked, type BufferedSocket } from "../../lib/backpressure.js"

export type Outgoing = WsEnvelope
export type Audience =
  | { kind: "users"; steamIds: string[] }
  | { kind: "broadcast" }
  | { kind: "admins" }
  | { kind: "match"; matchId: string }
  | { kind: "tournament"; tournamentId: string }

// Anything services use to push messages to connected players
export interface Notifier {
  send(audience: Audience, msg: Outgoing): void
}

export function toUsers(notifier: Notifier, steamIds: string[], type: string, payload: unknown, ts = Date.now()): void {
  if (steamIds.length === 0) return
  notifier.send({ kind: "users", steamIds }, { type, payload, ts })
}

export type SocketLike = BufferedSocket
export const MAX_MATCH_SUBSCRIPTIONS = 20
export const MAX_TOURNAMENT_SUBSCRIPTIONS = 10

type IdsBySocket = Map<SocketLike, Set<string>>
type SocketsById = Map<string, Set<SocketLike>>

function follow(bySocket: IdsBySocket, byId: SocketsById, socket: SocketLike, id: string, max: number): boolean {
  const mine = bySocket.get(socket) ?? new Set<string>()
  if (!mine.has(id) && mine.size >= max) return false
  mine.add(id)
  bySocket.set(socket, mine)
  const subs = byId.get(id) ?? new Set<SocketLike>()
  subs.add(socket)
  byId.set(id, subs)
  return true
}

function unfollow(bySocket: IdsBySocket, byId: SocketsById, socket: SocketLike, id: string): void {
  bySocket.get(socket)?.delete(id)
  const subs = byId.get(id)
  if (!subs) return
  subs.delete(socket)
  if (subs.size === 0) byId.delete(id)
}

// Sockets connected to this process
export class LocalHub {
  private readonly byUser = new Map<string, Set<SocketLike>>()
  private readonly admins = new Set<SocketLike>()
  private readonly matchSubs = new Map<string, Set<SocketLike>>()
  private readonly socketMatches = new Map<SocketLike, Set<string>>()
  private readonly tournamentSubs = new Map<string, Set<SocketLike>>()
  private readonly socketTournaments = new Map<SocketLike, Set<string>>()

  // Returns false when the socket already follows the maximum number of tournaments
  subscribeTournament(socket: SocketLike, tournamentId: string): boolean {
    return follow(this.socketTournaments, this.tournamentSubs, socket, tournamentId, MAX_TOURNAMENT_SUBSCRIPTIONS)
  }

  unsubscribeTournament(socket: SocketLike, tournamentId: string): void {
    unfollow(this.socketTournaments, this.tournamentSubs, socket, tournamentId)
  }

  // Returns false when the socket already follows the maximum number of matches
  subscribeMatch(socket: SocketLike, matchId: string): boolean {
    return follow(this.socketMatches, this.matchSubs, socket, matchId, MAX_MATCH_SUBSCRIPTIONS)
  }

  unsubscribeMatch(socket: SocketLike, matchId: string): void {
    unfollow(this.socketMatches, this.matchSubs, socket, matchId)
  }

  // Drops every match subscription of a closed socket
  dropSocket(socket: SocketLike): void {
    for (const id of this.socketMatches.get(socket) ?? []) this.unsubscribeMatch(socket, id)
    this.socketMatches.delete(socket)
    for (const id of this.socketTournaments.get(socket) ?? []) this.unsubscribeTournament(socket, id)
    this.socketTournaments.delete(socket)
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
            : audience.kind === "tournament"
              ? [this.tournamentSubs.get(audience.tournamentId) ?? new Set<SocketLike>()]
            : audience.steamIds.map((id) => this.byUser.get(id)).filter((s): s is Set<SocketLike> => !!s)
    for (const set of targets) {
      for (const socket of set) sendChecked(socket, msg, data)
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
