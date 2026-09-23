import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { isUuid } from "./store.js"
import { TournamentError, type TournamentService } from "./service.js"
import type { Mode, TournamentStatus } from "./types.js"

const MODES: Mode[] = ["aim1v1", "aim2v2", "rush3v3"]
const STATUSES: TournamentStatus[] = ["open", "running", "completed", "cancelled"]

type IdParams = { Params: { id: string } }
type ListQuery = { Querystring: { status?: string; mode?: string; limit?: string } }

export function registerRoutes(
  app: FastifyInstance,
  service: TournamentService,
  authenticate: (request: FastifyRequest) => Promise<string | null>,
) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof TournamentError) {
      return reply
        .code(err.statusCode)
        .send({ error: err.code, message: err.message, details: err.details })
    }
    throw err
  })

  async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const steamId = await authenticate(req)
    if (!steamId) {
      await reply.code(401).send({ error: "unauthorized", message: "Sign in first" })
      return null
    }
    return steamId
  }

  function checkId(id: string) {
    if (!isUuid(id)) throw new TournamentError(404, "not_found", "Tournament not found")
  }

  app.get<ListQuery>("/tournaments", async (req) => {
    const status = req.query.status
      ?.split(",")
      .filter((x): x is TournamentStatus => STATUSES.includes(x as TournamentStatus))
    const mode = MODES.includes(req.query.mode as Mode) ? (req.query.mode as Mode) : undefined
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    const viewer = await authenticate(req)
    return { tournaments: await service.list({ status, mode, limit }, viewer) }
  })

  app.get<IdParams>("/tournaments/:id", async (req) => {
    checkId(req.params.id)
    const viewer = await authenticate(req)
    return { tournament: await service.detail(req.params.id, viewer) }
  })

  app.post<IdParams>("/tournaments/:id/enter", async (req, reply) => {
    checkId(req.params.id)
    const steamId = await requireUser(req, reply)
    if (!steamId) return reply
    const entry = await service.enter(req.params.id, steamId)
    return reply.code(201).send({ entry })
  })

  app.delete<IdParams>("/tournaments/:id/enter", async (req, reply) => {
    checkId(req.params.id)
    const steamId = await requireUser(req, reply)
    if (!steamId) return reply
    await service.withdraw(req.params.id, steamId)
    return reply.code(204).send()
  })
}
