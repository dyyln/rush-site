import { ClientMessageSchema, type ClientMessage } from "@rushsite/shared"
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify"
import type { WebSocket } from "ws"
import type { AppContext } from "../../context.js"
import { realtimeMetrics, sendChecked } from "../../lib/backpressure.js"
import { ApiError } from "../../lib/errors.js"
import {
  allowedOrigins,
  ConnectionCounter,
  originAllowed,
  TokenBucket,
  WS_MAX_PER_USER,
  WS_MAX_STRIKES,
  WS_MESSAGE_BURST,
  WS_MESSAGES_PER_SEC,
} from "../../lib/security.js"
import { MAX_MATCH_SUBSCRIPTIONS, MAX_TOURNAMENT_SUBSCRIPTIONS, type LocalHub } from "./hub.js"

type AuthedRequest = FastifyRequest & { wsSteamId?: string }

const PING_MS = 30_000

// Handles one client message. Errors go back to the sender as an error message
export async function handleClientMessage(ctx: AppContext, steamId: string, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case "accept_match":
      await ctx.flow.respond(steamId, msg.payload.matchId, msg.payload.accept)
      return
    case "veto_vote":
      await ctx.flow.vote(steamId, msg.payload.matchId, msg.payload.mapId)
      return
    case "queue_join":
      await ctx.queue.join(steamId, msg.payload.modes, msg.payload.minTrust)
      return
    case "queue_leave":
      await ctx.queue.leave(steamId, msg.payload.modes)
      return
    case "page_view":
      ctx.activity.pageView(steamId, msg.payload.path)
      return
    // Subscriptions are handled on the socket itself
    case "subscribe_match":
    case "unsubscribe_match":
    case "subscribe_tournament":
    case "unsubscribe_tournament":
    case "resync":
      return
  }
}

export type ClientSocket = {
  readonly readyState: number
  readonly OPEN: number
  readonly bufferedAmount?: number
  send(data: string): void
  close?(code?: number, reason?: string): void
  ping(): void
  terminate(): void
  on(event: "message", fn: (data: { toString(): string }) => void): unknown
  on(event: "pong" | "close", fn: () => void): unknown
}

// Wires one socket of a signed in player
export function attachSocket(
  ctx: AppContext,
  hub: LocalHub,
  socket: ClientSocket,
  steamId: string,
  log: FastifyBaseLogger,
): void {
  hub.add(steamId, socket, ctx.isAdmin(steamId))
  const send = (type: string, payload: unknown, ts = Date.now()) => {
    sendChecked(socket, { type, payload }, JSON.stringify({ type, payload, ts }))
  }
  let alive = true
  const heartbeat = () => {
    void ctx.presence.heartbeat(steamId).catch((err) => log.warn({ err, steamId }, "presence heartbeat failed"))
  }
  socket.on("pong", () => {
    alive = true
    heartbeat()
    ctx.activity.seen(steamId)
  })
  heartbeat()
  ctx.activity.connected(steamId)
  const ping = setInterval(() => {
    if (!alive) {
      socket.terminate()
      return
    }
    alive = false
    socket.ping()
  }, PING_MS)

  const bucket = new TokenBucket(WS_MESSAGE_BURST, WS_MESSAGES_PER_SEC)
  let strikes = 0
  socket.on("message", (data) => {
    if (!bucket.take()) {
      if (++strikes < WS_MAX_STRIKES) send("error", { code: "rate_limited", message: "slow down" })
      else if (socket.close) socket.close(1008, "rate limited")
      else socket.terminate()
      return
    }
    let parsed: ClientMessage
    try {
      const raw: unknown = JSON.parse(data.toString())
      const r = ClientMessageSchema.safeParse(raw)
      if (!r.success) {
        send("error", { code: "invalid_message", message: r.error.issues[0]?.message ?? "invalid" })
        return
      }
      parsed = r.data
      if (parsed.type === "subscribe_match" || parsed.type === "unsubscribe_match") {
        const { matchId } = parsed.payload
        if (parsed.type === "unsubscribe_match") hub.unsubscribeMatch(socket, matchId)
        else if (!hub.subscribeMatch(socket, matchId)) {
          send("error", {
            code: "too_many_subscriptions",
            message: `at most ${MAX_MATCH_SUBSCRIPTIONS} matches per connection`,
            for: parsed.type,
          })
        }
        return
      }
      // A page that mounts on an open socket missed the connect replay, so it asks for it again
      if (parsed.type === "resync") {
        void sendSnapshot(ctx, steamId, send).catch((err) => log.warn({ err, steamId }, "ws resync failed"))
        return
      }
      if (parsed.type === "subscribe_tournament" || parsed.type === "unsubscribe_tournament") {
        const { tournamentId } = parsed.payload
        if (parsed.type === "unsubscribe_tournament") hub.unsubscribeTournament(socket, tournamentId)
        else if (!hub.subscribeTournament(socket, tournamentId)) {
          send("error", {
            code: "too_many_subscriptions",
            message: `at most ${MAX_TOURNAMENT_SUBSCRIPTIONS} tournaments per connection`,
            for: parsed.type,
          })
        }
        return
      }
    } catch {
      send("error", { code: "invalid_json", message: "message is not valid JSON" })
      return
    }
    handleClientMessage(ctx, steamId, parsed).catch((err: unknown) => {
      if (err instanceof ApiError) send("error", { code: err.code, message: err.message, for: parsed.type })
      else {
        log.error({ err, steamId, type: parsed.type }, "ws message failed")
        send("error", { code: "internal", message: "something went wrong", for: parsed.type })
      }
    })
  })
  socket.on("close", () => {
    clearInterval(ping)
    hub.remove(steamId, socket)
    ctx.activity.seen(steamId, true)
  })

  // Initial snapshot so a reconnecting client catches up
  void sendSnapshot(ctx, steamId, send).catch((err) => log.warn({ err, steamId }, "ws snapshot failed"))
}

// Serves the Redis snapshot. Postgres is only read when it is missing
async function sendSnapshot(
  ctx: AppContext,
  steamId: string,
  send: (type: string, payload: unknown, ts?: number) => void,
): Promise<void> {
  const snap = await ctx.snapshots.read(steamId).catch(() => null)
  if (snap) {
    realtimeMetrics.snapshotHits++
    // Fresh timestamps so clients do not treat the replay as late
    for (const m of [snap.party, snap.queue, snap.match]) if (m) send(m.type, m.payload)
    return
  }
  realtimeMetrics.snapshotMisses++
  const ts = Date.now()
  const party = await ctx.parties.payload(await ctx.parties.partyOf(steamId))
  const queue = await ctx.queue.status(steamId)
  send("party_update", party, ts)
  send("queue_status", queue, ts)
  // Live messages written meanwhile win. resendState then fills the match phase through the notifier
  await ctx.snapshots
    .update(
      steamId,
      { party: { type: "party_update", payload: party, ts }, queue: { type: "queue_status", payload: queue, ts }, match: null },
      { onlyMissing: true },
    )
    .catch(() => undefined)
  await ctx.flow.resendState(steamId)
}

export function registerWsRoutes(app: FastifyInstance, ctx: AppContext, hub: LocalHub): void {
  const origins = allowedOrigins(ctx.env)
  const counter = new ConnectionCounter()
  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        // Stops other sites from riding the session cookie over a socket
        if (!originAllowed(req, origins)) return reply.code(403).send({ error: "bad_origin" })
        // Signed out visitors get no socket. Public pages poll instead
        const steamId = await ctx.auth(req)
        if (!steamId) return reply.code(401).send({ error: "unauthorized" })
        ;(req as AuthedRequest).wsSteamId = steamId
        if (!counter.tryOpen(steamId, WS_MAX_PER_USER)) return reply.code(429).send({ error: "too_many_connections" })
      },
    },
    (socket: WebSocket, req: FastifyRequest) => {
      const steamId = (req as AuthedRequest).wsSteamId!
      socket.on("close", () => counter.close(steamId))
      attachSocket(ctx, hub, socket, steamId, req.log)
    },
  )
}
