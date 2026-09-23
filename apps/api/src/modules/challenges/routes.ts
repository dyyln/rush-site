import { CreateChallengeBodySchema } from "@rushsite/shared"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badRequest, notFound } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"
import type { ChallengeService } from "./service.js"

const CodeParams = z.object({ code: z.string().regex(/^[A-Za-z0-9]{4,16}$/) })

function codeOf(params: unknown): string {
  const r = CodeParams.safeParse(params)
  if (!r.success) throw notFound("challenge_not_found")
  return r.data.code
}

export function registerChallengeRoutes(app: FastifyInstance, ctx: AppContext, service: ChallengeService): void {
  app.post("/challenges", async (req, reply) => {
    const steamId = await requireUser(ctx.auth, req)
    const body = CreateChallengeBodySchema.safeParse(req.body ?? {})
    if (!body.success) throw badRequest("invalid_body", body.error.issues[0]?.message)
    const out = await service.create(steamId, body.data)
    return reply.code(201).send(out)
  })

  // Registered before /:code so "mine" is never read as a code
  app.get("/challenges/mine", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return { challenges: await service.mine(steamId) }
  })

  // Public so a signed out visitor can see who is calling them out before signing in
  app.get("/challenges/:code", async (req) => {
    return { challenge: await service.get(codeOf(req.params)) }
  })

  app.post("/challenges/:code/accept", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return { challenge: await service.accept(steamId, codeOf(req.params)) }
  })

  app.post("/challenges/:code/decline", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return { challenge: await service.decline(steamId, codeOf(req.params)) }
  })
}
