import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { DEFAULT_CUPS } from "./config.js"
import { registerRoutes } from "./routes.js"
import { TournamentService } from "./service.js"
import { DrizzleTournamentStore, type TournamentStore } from "./store.js"
import type { TournamentsPluginOptions } from "./types.js"

export type { TournamentsPluginOptions } from "./types.js"
export * as tournamentsSchema from "./schema.js"

export interface TournamentsPluginInternals {
  // Tests pass an in-memory store and take the service to drive ticks.
  store?: TournamentStore
  onService?: (service: TournamentService) => void
}

const tournamentsPlugin: FastifyPluginAsync<
  TournamentsPluginOptions & TournamentsPluginInternals
> = async (app: FastifyInstance, opts) => {
  const service = new TournamentService({
    store: opts.store ?? new DrizzleTournamentStore(opts.db),
    cups: opts.cups ?? DEFAULT_CUPS,
    now: opts.now ?? (() => new Date()),
    log: app.log,
    startMatch: opts.startMatch,
    emit: opts.emit,
    getTrustLevels: opts.getTrustLevels,
    getRatings: opts.getRatings,
    getParty: opts.getParty,
    getProfiles: opts.getProfiles,
  })

  opts.onMatchResult(async (result) => {
    try {
      await service.handleResult(result)
    } catch (err) {
      app.log.error({ err, matchId: result.matchId }, "tournament result handling failed")
    }
  })

  registerRoutes(app, service, opts.authenticate)
  opts.onService?.(service)

  if (opts.scheduler !== false) {
    const run = () =>
      service.tick().catch((err) => app.log.error({ err }, "tournament scheduler tick failed"))
    let timer: NodeJS.Timeout | undefined
    app.addHook("onReady", async () => {
      void run()
      timer = setInterval(run, opts.schedulerIntervalMs ?? 30_000)
    })
    app.addHook("onClose", async () => {
      if (timer) clearInterval(timer)
    })
  }
}

export default tournamentsPlugin
