import type { FastifyInstance } from "fastify"
import { activityOverview, userActivityView } from "../activity/stats.js"
import { AdminError } from "./routes.js"
import type { AdminPluginOptions } from "./types.js"

const STEAM_ID = /^\d{17}$/

export function registerActivityRoutes(app: FastifyInstance, deps: { opts: Pick<AdminPluginOptions, "db">; now(): Date }): void {
  app.get("/admin/activity", async () => activityOverview(deps.opts.db, deps.now()))

  app.get<{ Params: { steamId: string } }>("/admin/users/:steamId/activity", async (req) => {
    if (!STEAM_ID.test(req.params.steamId)) throw new AdminError(404, "not_found", "User not found")
    return userActivityView(deps.opts.db, req.params.steamId)
  })
}
