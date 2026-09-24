import { CHAT_GLOBAL_CHANNEL, CHAT_HISTORY_LIMIT, ChatChannelSchema, ChatPostSchema, type ChatHistoryResponse } from "@rushsite/shared"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badRequest, notFound } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"

// Only the global channel is open. Match rooms get their own channel later
const OPEN_CHANNELS = new Set<string>([CHAT_GLOBAL_CHANNEL])

const HistoryQuery = z.object({
  channel: ChatChannelSchema.default(CHAT_GLOBAL_CHANNEL),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_HISTORY_LIMIT).optional(),
})

function openChannel(channel: string): string {
  if (!OPEN_CHANNELS.has(channel)) throw notFound("channel_not_found")
  return channel
}

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Guests can read. Signed in viewers also get their mute status
  app.get("/chat/messages", async (req): Promise<ChatHistoryResponse> => {
    const q = HistoryQuery.safeParse(req.query ?? {})
    if (!q.success) throw badRequest("invalid_query", q.error.issues[0]?.message)
    const channel = openChannel(q.data.channel)
    const viewer = await ctx.auth(req)
    const messages = await ctx.chat.history(channel, {
      ...(q.data.before ? { before: new Date(q.data.before) } : {}),
      ...(q.data.limit ? { limit: q.data.limit } : {}),
    })
    return { channel, messages, ...(viewer ? { me: { muted: await ctx.chat.activeMute(viewer) } } : {}) }
  })

  app.post("/chat/messages", async (req, reply) => {
    const steamId = await requireUser(ctx.auth, req)
    const body = ChatPostSchema.safeParse(req.body ?? {})
    if (!body.success) throw badRequest("invalid_body", body.error.issues[0]?.message)
    const message = await ctx.chat.post(steamId, openChannel(body.data.channel), body.data.body)
    return reply.code(201).send({ message })
  })
}
