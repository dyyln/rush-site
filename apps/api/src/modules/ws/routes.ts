import { ClientMessageSchema, type ClientMessage } from "@rushsite/shared"
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify"
import type { WebSocket } from "ws"
import type { AppContext } from "../../context.js"
import { ApiError } from "../../lib/errors.js"
import { z } from "zod"
import { MAX_MATCH_SUBSCRIPTIONS, type LocalHub } from "./hub.js"

// Local until shared adds these to ClientMessageSchema
const SubscriptionMessage = z.object({
  type: z.enum(["subscribe_match", "unsubscribe_match"]),
  payload: z.object({ matchId: z.uuid() }),
})

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
      await ctx.queue.join(steamId, msg.payload.modes)
      return
    case "queue_leave":
      await ctx.queue.leave(steamId, msg.payload.modes)
      return
  }
}

export type ClientSocket = {
  readonly readyState: number
  readonly OPEN: number
  send(data: string): void
  ping(): void
  terminate(): void
  on(event: "message", fn: (data: { toString(): string }) => void): unknown
  on(event: "pong" | "close", fn: () => void): unknown
}

// Wires one socket. steamId is null for signed out spectators, who may only follow match pages
export function attachSocket(
  ctx: AppContext,
  hub: LocalHub,
  socket: ClientSocket,
  steamId: string | null,
  log: FastifyBaseLogger,
): void {
  // Spectators register under a private key so they get match and broadcast messages only
  const hubKey = steamId ?? `anon:${Math.random().toString(36).slice(2)}`
  hub.add(hubKey, socket, !!steamId && ctx.isAdmin(steamId))
  const send = (type: string, payload: unknown) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, payload, ts: Date.now() }))
  }
  let alive = true
  socket.on("pong", () => {
    alive = true
  })
  const ping = setInterval(() => {
    if (!alive) {
      socket.terminate()
      return
    }
    alive = false
    socket.ping()
  }, PING_MS)

  socket.on("message", (data) => {
    let parsed: ClientMessage
    try {
      const raw: unknown = JSON.parse(data.toString())
      const sub = SubscriptionMessage.safeParse(raw)
      if (sub.success) {
        const { matchId } = sub.data.payload
        if (sub.data.type === "unsubscribe_match") hub.unsubscribeMatch(socket, matchId)
        else if (!hub.subscribeMatch(socket, matchId)) {
          send("error", {
            code: "too_many_subscriptions",
            message: `at most ${MAX_MATCH_SUBSCRIPTIONS} matches per connection`,
            for: sub.data.type,
          })
        }
        return
      }
      const r = ClientMessageSchema.safeParse(raw)
      if (!r.success) {
        send("error", { code: "invalid_message", message: r.error.issues[0]?.message ?? "invalid" })
        return
      }
      parsed = r.data
    } catch {
      send("error", { code: "invalid_json", message: "message is not valid JSON" })
      return
    }
    if (!steamId) {
      send("error", { code: "unauthorized", message: "sign in first", for: parsed.type })
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
    hub.remove(hubKey, socket)
  })

  // Initial snapshot so a reconnecting client catches up
  if (steamId) {
    void (async () => {
      send("party_update", await ctx.parties.payload(await ctx.parties.partyOf(steamId)))
      send("queue_status", await ctx.queue.status(steamId))
      await ctx.flow.resendState(steamId)
    })().catch((err) => log.warn({ err, steamId }, "ws snapshot failed"))
  }
}

export function registerWsRoutes(app: FastifyInstance, ctx: AppContext, hub: LocalHub): void {
  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (req) => {
        ;(req as AuthedRequest).wsSteamId = (await ctx.auth(req)) ?? undefined
      },
    },
    (socket: WebSocket, req: FastifyRequest) => {
      attachSocket(ctx, hub, socket, (req as AuthedRequest).wsSteamId ?? null, req.log)
    },
  )
}
