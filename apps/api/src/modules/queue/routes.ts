import { QueueJoinPayloadSchema, QueueLeavePayloadSchema, UserSettingsPatchSchema } from "@rushsite/shared"
import type { FastifyInstance } from "fastify"
import type { AppContext } from "../../context.js"
import { badRequest } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"

export function registerQueueRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/queue/join", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const body = QueueJoinPayloadSchema.safeParse(req.body)
    if (!body.success) throw badRequest("invalid_body", body.error.message)
    await ctx.queue.join(steamId, body.data.modes, body.data.minTrust)
    return ctx.queue.status(steamId)
  })

  app.post("/queue/leave", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const body = QueueLeavePayloadSchema.safeParse(req.body ?? {})
    if (!body.success) throw badRequest("invalid_body", body.error.message)
    await ctx.queue.leave(steamId, body.data.modes)
    return ctx.queue.status(steamId)
  })

  app.get("/me/settings", async (req) => ctx.queue.getSettings(await requireUser(ctx.auth, req)))

  app.patch("/me/settings", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const body = UserSettingsPatchSchema.strict().safeParse(req.body ?? {})
    if (!body.success) throw badRequest("invalid_body", body.error.message)
    return ctx.queue.updateSettings(steamId, body.data)
  })

  app.get("/queue/status", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return ctx.queue.status(steamId)
  })
}
