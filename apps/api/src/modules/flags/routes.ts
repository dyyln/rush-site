import type { FastifyInstance } from "fastify"
import type { AnnouncementService, FlagService } from "./service.js"

// Public reads. Admin writes live in the admin plugin under /admin
export function registerFlagRoutes(app: FastifyInstance, deps: { flags: FlagService; announcements: AnnouncementService }): void {
  app.get("/flags", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=15")
    return { flags: await deps.flags.publicFlags() }
  })
  app.get("/announcements", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=30")
    return { announcements: await deps.announcements.active() }
  })
}
