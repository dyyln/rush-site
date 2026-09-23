import { ClientMessageSchema, type ClientMessage } from "@rushsite/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import type { WebSocket } from "ws"
import type { AppContext } from "../../context.js"
import { ApiError } from "../../lib/errors.js"
import type { LocalHub } from "./hub.js"

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

export function registerWsRoutes(app: FastifyInstance, ctx: AppContext, hub: LocalHub): void {
  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const steamId = await ctx.auth(req)
        if (!steamId) return reply.code(401).send({ error: "unauthorized" })
        ;(req as AuthedRequest).wsSteamId = steamId
      },
    },
    (socket: WebSocket, req: FastifyRequest) => {
      const steamId = (req as AuthedRequest).wsSteamId!
      const isAdmin = ctx.isAdmin(steamId)
      hub.add(steamId, socket, isAdmin)
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
          const r = ClientMessageSchema.safeParse(JSON.parse(data.toString()))
          if (!r.success) {
            send("error", { code: "invalid_message", message: r.error.issues[0]?.message ?? "invalid" })
            return
          }
          parsed = r.data
        } catch {
          send("error", { code: "invalid_json" })
          return
        }
        handleClientMessage(ctx, steamId, parsed).catch((err: unknown) => {
          if (err instanceof ApiError) send("error", { code: err.code, message: err.message, for: parsed.type })
          else {
            req.log.error({ err, steamId, type: parsed.type }, "ws message failed")
            send("error", { code: "internal", for: parsed.type })
          }
        })
      })
      socket.on("close", () => {
        clearInterval(ping)
        hub.remove(steamId, socket)
      })

      // Initial snapshot so a reconnecting client catches up
      void (async () => {
        send("party_update", await ctx.parties.payload(await ctx.parties.partyOf(steamId)))
        send("queue_status", await ctx.queue.status(steamId))
        await ctx.flow.resendState(steamId)
      })().catch((err) => req.log.warn({ err, steamId }, "ws snapshot failed"))
    },
  )
}
