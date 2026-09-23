import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify"
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

  registerRoutes(
    app,
    {
      store: opts.store ?? new DrizzleAdminStore(opts.db),
      hooks: opts,
      pingRedis: () => opts.redis.ping(),
      now: opts.now ?? (() => new Date()),
    },
    (req) => {
      const id = admins.get(req)
      if (!id) throw new Error("admin identity missing")
      return id
    },
  )
}

export default adminPlugin
