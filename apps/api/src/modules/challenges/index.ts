import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import type { AppContext } from "../../context.js"
import { registerChallengeRoutes } from "./routes.js"
import { ChallengeService } from "./service.js"

export { ChallengeService } from "./service.js"

const MAX_SKIP = 20

export type ChallengesPluginOptions = {
  ctx: AppContext
  // Runs the expiry sweep. Off in tests, which call expireDue directly
  scheduler?: boolean
  expiryIntervalMs?: number
  onService?: (service: ChallengeService) => void
}

const challengesPlugin: FastifyPluginAsync<ChallengesPluginOptions> = async (app: FastifyInstance, opts) => {
  const service = new ChallengeService(opts.ctx)
  registerChallengeRoutes(app, opts.ctx, service)
  opts.onService?.(service)

  if (opts.scheduler !== false) {
    let timer: NodeJS.Timeout | undefined
    // Failures back off up to MAX_SKIP ticks and log once per distinct error, so a missing table does not flood the log
    let skip = 0
    let backoff = 0
    let lastError = ""
    const run = async () => {
      if (skip > 0) {
        skip--
        return
      }
      try {
        await service.expireDue()
        if (lastError) app.log.info("challenge expiry sweep recovered")
        backoff = 0
        lastError = ""
      } catch (err) {
        const cause = (err as { cause?: { code?: string; message?: string } }).cause
        const message = cause?.message ?? (err as Error).message
        if (message !== lastError) {
          const hint = cause?.code === "42P01" ? "challenges table missing, run migrations" : undefined
          app.log.warn({ err, hint }, "challenge expiry sweep failed, backing off")
          lastError = message
        }
        backoff = Math.min(Math.max(backoff * 2, 1), MAX_SKIP)
        skip = backoff
      }
    }
    app.addHook("onReady", async () => {
      timer = setInterval(run, opts.expiryIntervalMs ?? 15_000)
    })
    app.addHook("onClose", async () => {
      if (timer) clearInterval(timer)
    })
  }
}

export default challengesPlugin
