import { ChatMuteRequestSchema, SteamId64Schema, UuidSchema } from "@rushsite/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { AdminError } from "./routes.js"
import type { AdminStore } from "./store.js"
import type { AdminPluginOptions, ChatModerationLike } from "./types.js"

export interface ChatModerationDeps {
  store: AdminStore
  opts: Pick<AdminPluginOptions, "chat" | "emitAdmin">
  now(): Date
}

export function registerChatModerationRoutes(
  app: FastifyInstance,
  deps: ChatModerationDeps,
  adminOf: (req: FastifyRequest) => string,
) {
  const { store, opts, now } = deps

  const chat = (): ChatModerationLike => {
    if (!opts.chat) throw new AdminError(404, "not_found", "Chat is not available")
    return opts.chat
  }
  const checkSteamId = (id: string) => {
    if (!SteamId64Schema.safeParse(id).success) throw new AdminError(404, "not_found", "User not found")
  }

  app.get("/admin/chat/mutes", async () => ({ mutes: await chat().mutes() }))

  app.delete<{ Params: { id: string } }>("/admin/chat/messages/:id", async (req) => {
    if (!UuidSchema.safeParse(req.params.id).success) throw new AdminError(404, "not_found", "Message not found")
    const by = adminOf(req)
    const removed = await chat().remove(req.params.id, by)
    if (!removed) throw new AdminError(404, "not_found", "Message not found")
    const entry = await store.writeAudit({
      adminSteamId: by,
      action: "chat.delete",
      target: removed.steamId,
      payload: { messageId: removed.id, channel: removed.channel, body: removed.body },
    })
    return { ok: true, audit: entry }
  })

  app.put<{ Params: { steamId: string } }>("/admin/chat/mutes/:steamId", async (req) => {
    const { steamId } = req.params
    checkSteamId(steamId)
    const r = ChatMuteRequestSchema.safeParse(req.body)
    if (!r.success) {
      throw new AdminError(400, "invalid_request", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "))
    }
    const by = adminOf(req)
    if (steamId === by) throw new AdminError(400, "cannot_mute_self", "You cannot mute yourself")
    const until = r.data.minutes === null ? null : new Date(now().getTime() + r.data.minutes * 60_000)
    const mute = await chat().mute(steamId, until, r.data.reason, by)
    const entry = await store.writeAudit({ adminSteamId: by, action: "chat.mute", target: steamId, payload: mute })
    opts.emitAdmin("user", { action: "chat_muted", steamId, until: mute.until, by })
    return { mute, audit: entry }
  })

  app.delete<{ Params: { steamId: string } }>("/admin/chat/mutes/:steamId", async (req) => {
    const { steamId } = req.params
    checkSteamId(steamId)
    if (!(await chat().unmute(steamId))) throw new AdminError(404, "not_found", "User is not muted")
    const by = adminOf(req)
    const entry = await store.writeAudit({ adminSteamId: by, action: "chat.unmute", target: steamId, payload: {} })
    opts.emitAdmin("user", { action: "chat_unmuted", steamId, by })
    return { ok: true, audit: entry }
  })
}
