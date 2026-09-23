import { ModeSchema, type Mode } from "@rushsite/shared"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badRequest, notFound } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"
import { tierDistribution } from "./distribution.js"
import { createEtaSource } from "./eta.js"
import { friendsLeaderboard } from "./friends.js"
import { liveMatches } from "./live.js"
import { createAvailabilitySource, serviceStatus } from "./status.js"

const LiveQuery = z.object({ limit: z.coerce.number().int().min(1).max(24).default(6) })

function modeParam(params: unknown): Mode {
  const mode = ModeSchema.safeParse((params as { mode?: string }).mode)
  if (!mode.success) throw notFound("unknown_mode")
  return mode.data
}

// Queue ETA, friends leaderboard, tier distribution, status page and live matches
export function registerStatsFeatures(app: FastifyInstance, ctx: AppContext): void {
  ctx.queue.setEtaSource(createEtaSource(ctx.db, ctx.now))
  ctx.queue.setAvailabilitySource(createAvailabilitySource(ctx))

  app.get("/leaderboard/:mode/friends", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return friendsLeaderboard(ctx, modeParam(req.params), steamId)
  })

  app.get("/leaderboard/:mode/distribution", async (req) => {
    const mode = modeParam(req.params)
    return tierDistribution(ctx.db, mode, await ctx.auth(req))
  })

  app.get("/status", async () => serviceStatus(ctx))

  app.get("/matches/live", async (req) => {
    const q = LiveQuery.safeParse(req.query)
    if (!q.success) throw badRequest("invalid_query", "bad limit", q.error.issues)
    return { matches: await liveMatches(ctx.db, q.data.limit) }
  })
}
