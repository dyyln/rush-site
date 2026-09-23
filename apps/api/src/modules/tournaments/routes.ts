import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { isUuid } from "./store.js"
import { TournamentError, type TournamentService } from "./service.js"
import { EnterTournamentBodySchema, MODES, TournamentStatusSchema } from "@rushsite/shared"
import type { Mode, TournamentStatus } from "./types.js"

const STATUSES = TournamentStatusSchema.options

type IdParams = { Params: { id: string } }
type ListQuery = { Querystring: { status?: string; mode?: string; limit?: string } }

// Takes the first version out of an If-None-Match header such as "3" or W/"3".
function parseIfNoneMatch(header: string | undefined): number | null {
  if (!header) return null
  for (const part of header.split(",")) {
    const m = /^\s*(?:W\/)?"(\d+)"\s*$/.exec(part)
    if (m) return Number(m[1])
  }
  return null
}

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

  app.get<IdParams>("/tournaments/:id/bracket", async (req, reply) => {
    checkId(req.params.id)
    const known = parseIfNoneMatch(req.headers["if-none-match"])
    const res = await service.bracket(req.params.id, known)
    reply.header("etag", `"${res.version}"`).header("cache-control", "no-cache")
    if (res.bracket === undefined) return reply.code(304).send()
    return { tournamentId: req.params.id, version: res.version, bracket: res.bracket }
  })

  app.post<IdParams>("/tournaments/:id/enter", async (req, reply) => {
    checkId(req.params.id)
    const steamId = await requireUser(req, reply)
    if (!steamId) return reply
    const body = EnterTournamentBodySchema.safeParse(req.body ?? undefined)
    if (!body.success) {
      throw new TournamentError(400, "invalid_team_name", body.error.issues[0]?.message ?? "Invalid team name")
    }
    const entry = await service.enter(req.params.id, steamId, body.data?.teamName)
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
