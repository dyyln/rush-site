import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { registerAdminRoutes } from "./admin-routes.js"
import { cupToSchedule } from "./config.js"
import { registerRoutes } from "./routes.js"
import { TournamentService } from "./service.js"
import { DrizzleTournamentStore, type TournamentStore } from "./store.js"
import type { TournamentsPluginOptions } from "./types.js"

export type { TournamentsPluginOptions } from "./types.js"

export interface TournamentsPluginInternals {
  // Tests pass an in-memory store and take the service to drive ticks.
  store?: TournamentStore
  onService?: (service: TournamentService) => void
}

const tournamentsPlugin: FastifyPluginAsync<
  TournamentsPluginOptions & TournamentsPluginInternals
> = async (app: FastifyInstance, opts) => {
  const store = opts.store ?? new DrizzleTournamentStore(opts.db)
  // Tests pass cups to seed an empty store. Production reads the cup_schedules table.
  if (opts.cups && (await store.listSchedules()).length === 0) {
    for (const cup of opts.cups) await store.insertSchedule(cupToSchedule(cup))
  }
  const service = new TournamentService({
    store,
    now: opts.now ?? (() => new Date()),
    log: app.log,
    startMatch: opts.startMatch,
    emit: opts.emit,
    getTrustLevels: opts.getTrustLevels,
    getRatings: opts.getRatings,
    getParty: opts.getParty,
    getProfiles: opts.getProfiles,
    cancelMatch: opts.cancelMatch,
    modeGate: opts.modeGate,
  })

  opts.onMapResult?.(async (result) => {
    try {
      await service.handleMapResult(result)
    } catch (err) {
      app.log.error({ err, matchId: result.matchId }, "tournament map result handling failed")
    }
  })

  opts.onMatchResult(async (result) => {
    try {
      await service.handleResult(result)
    } catch (err) {
      app.log.error({ err, matchId: result.matchId }, "tournament result handling failed")
    }
  })

  registerRoutes(app, service, opts.authenticate)
  if (opts.isAdmin) {
    registerAdminRoutes(app, service, store, { authenticate: opts.authenticate, isAdmin: opts.isAdmin })
  }
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
