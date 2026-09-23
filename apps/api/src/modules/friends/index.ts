import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import type { AppContext } from "../../context.js"
import { withLock } from "../../lib/redis.js"
import { registerFriendRoutes } from "./routes.js"

export { FriendsService } from "./service.js"
export { PresenceService } from "./presence.js"

export type FriendsPluginOptions = {
  ctx: AppContext
  // Runs the presence and invite sweeps. Off in tests, which call them directly
  scheduler?: boolean
  sweepIntervalMs?: number
}

const friendsPlugin: FastifyPluginAsync<FriendsPluginOptions> = async (app: FastifyInstance, opts) => {
  const { ctx } = opts
  registerFriendRoutes(app, ctx)

  if (opts.scheduler !== false) {
    let timer: NodeJS.Timeout | undefined
    let lastError = ""
    const run = async () => {
      try {
        await withLock(ctx.redis, "lock:friends_sweep", 30_000, async () => {
          await ctx.presence.sweep()
          await ctx.friends.expireInvites()
        })
        lastError = ""
      } catch (err) {
        const message = (err as Error).message
        if (message !== lastError) app.log.warn({ err }, "friends sweep failed")
        lastError = message
      }
    }
    app.addHook("onReady", async () => {
      timer = setInterval(run, opts.sweepIntervalMs ?? 15_000)
    })
    app.addHook("onClose", async () => {
      if (timer) clearInterval(timer)
    })
  }
}

export default friendsPlugin
