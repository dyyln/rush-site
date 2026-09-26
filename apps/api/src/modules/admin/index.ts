import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify"
import { registerActivityRoutes } from "./activity-routes.js"
import { registerAdminsRoutes } from "./admins-routes.js"
import { registerChatModerationRoutes } from "./chat-routes.js"
import { registerMapsRoutes } from "./maps-routes.js"
import { registerOpsRoutes } from "./ops-routes.js"
import { registerRoutes, requireAdmin } from "./routes.js"
import { DrizzleAdminStore, type AdminStore } from "./store.js"
import type { AdminPluginOptions } from "./types.js"

export type * from "./types.js"

export interface AdminPluginInternals {
  // Tests pass an in-memory store.
  store?: AdminStore
}

// Register without a prefix. Routes carry the full /admin path.
const adminPlugin: FastifyPluginAsync<AdminPluginOptions & AdminPluginInternals> = async (
  app: FastifyInstance,
  opts,
) => {
  const admins = new WeakMap<FastifyRequest, string>()

  // Everything in this plugin is admin only. Anyone else gets the stock 404.
  app.addHook("onRequest", async (req, reply) => {
    const steamId = await requireAdmin(req, reply, opts)
    if (!steamId) return reply
    admins.set(req, steamId)
  })

  const store = opts.store ?? new DrizzleAdminStore(opts.db)
  const adminOf = (req: FastifyRequest) => {
    const id = admins.get(req)
    if (!id) throw new Error("admin identity missing")
    return id
  }
  const now = opts.now ?? (() => new Date())

  registerRoutes(
    app,
    {
      store,
      hooks: opts,
      pingRedis: () => opts.redis.ping(),
      now,
    },
    adminOf,
  )
  registerOpsRoutes(app, { store, opts, now }, adminOf)
  registerAdminsRoutes(app, { store, opts }, adminOf)
  registerChatModerationRoutes(app, { store, opts, now }, adminOf)
  registerMapsRoutes(app, { store, opts }, adminOf)
  registerActivityRoutes(app, { opts, now })
}

export default adminPlugin
