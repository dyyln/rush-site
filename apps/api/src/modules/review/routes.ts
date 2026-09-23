import { FLAG_STATUSES, MyReportsQuerySchema, ReviewDecideBodySchema, UuidSchema } from "@rushsite/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badRequest, notFound } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"
import type { ReviewService } from "./service.js"

const ListQuery = z.object({ status: z.enum([...FLAG_STATUSES, "all"]).default("open") })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw badRequest("invalid_request", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "))
  return r.data
}

function flagId(req: FastifyRequest): string {
  const { flagId: id } = req.params as { flagId: string }
  if (!UuidSchema.safeParse(id).success) throw notFound("flag_not_found")
  return id
}

// Admin routes. Anyone else gets the stock 404 like the rest of /admin
export async function registerReviewAdminRoutes(app: FastifyInstance, ctx: AppContext, service: ReviewService): Promise<void> {
  const admins = new WeakMap<FastifyRequest, string>()
  app.addHook("onRequest", async (req, reply) => {
    let steamId: string | null = null
    try {
      steamId = await ctx.auth(req)
    } catch {
      steamId = null
    }
    if (!steamId || !ctx.isAdmin(steamId)) return reply.callNotFound()
    admins.set(req, steamId)
  })
  const adminOf = (req: FastifyRequest) => {
    const id = admins.get(req)
    if (!id) throw new Error("admin identity missing")
    return id
  }

  app.get("/admin/review", async (req) => {
    const { status } = parse(ListQuery, req.query)
    return service.list(status)
  })

  app.get("/admin/review/:flagId", async (req) => ({ flag: await service.get(flagId(req)) }))

  app.post("/admin/review/:flagId/claim", async (req) => ({ flag: await service.claim(flagId(req), adminOf(req)) }))

  app.post("/admin/review/:flagId/decide", async (req) => {
    const id = flagId(req)
    const body = parse(ReviewDecideBodySchema, req.body)
    if (body.ban && body.outcome !== "confirmed") throw badRequest("invalid_request", "ban: only allowed with confirmed")
    if (body.ban?.until && Date.parse(body.ban.until) <= ctx.now()) throw badRequest("invalid_request", "ban.until: must be in the future")
    return service.decide(id, adminOf(req), body)
  })
}

export function registerMyReportsRoute(app: FastifyInstance, ctx: AppContext, service: ReviewService): void {
  app.get("/me/reports", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const q = parse(MyReportsQuerySchema, req.query)
    return { reports: await service.myReports(steamId, q) }
  })
}
