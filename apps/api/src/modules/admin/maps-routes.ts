import {
  PoolMapCreateSchema,
  PoolMapIdSchema,
  PoolMapPatchSchema,
  PoolOrderSchema,
  parseWorkshopRef,
  slugMapId,
  type WorkshopItem,
} from "@rushsite/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import type { z } from "zod"
import { PoolError } from "../maps/pool.js"
import { WorkshopError } from "../maps/workshop.js"
import { AdminError } from "./routes.js"
import type { AdminStore } from "./store.js"
import type { AdminPluginOptions, MapPoolLike } from "./types.js"

export interface MapsDeps {
  store: AdminStore
  opts: Pick<AdminPluginOptions, "mapPool" | "fetchWorkshop" | "emitAdmin">
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) {
    throw new AdminError(400, "invalid_request", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "))
  }
  return r.data
}

const WORKSHOP_STATUS: Record<WorkshopError["code"], number> = {
  not_found: 404,
  not_cs2: 422,
  not_a_map: 422,
  steam_unavailable: 502,
}

// Pool and Steam errors become admin errors with the same code
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof PoolError) throw new AdminError(err.statusCode, err.code, err.message, err.details)
    if (err instanceof WorkshopError) {
      throw new AdminError(WORKSHOP_STATUS[err.code], err.code === "not_found" ? "workshop_not_found" : err.code, err.message)
    }
    throw err
  }
}

export function registerMapsRoutes(app: FastifyInstance, deps: MapsDeps, adminOf: (req: FastifyRequest) => string) {
  const { store, opts } = deps

  const pool = (): MapPoolLike => {
    if (!opts.mapPool) throw new AdminError(404, "not_found", "The map pool is not available")
    return opts.mapPool
  }
  const workshop = (ref: string): Promise<WorkshopItem> => {
    if (!opts.fetchWorkshop) throw new AdminError(404, "not_found", "Workshop lookups are not available")
    const id = parseWorkshopRef(ref)
    if (!id) throw new AdminError(400, "invalid_request", "Enter a Workshop id or a steamcommunity.com filedetails URL")
    return guard(() => opts.fetchWorkshop!(id))
  }
  const checkId = (id: string) => {
    if (!PoolMapIdSchema.safeParse(id).success) throw new AdminError(404, "not_found", "Map not found")
  }
  const changed = (req: FastifyRequest, action: string, mapId: string) =>
    opts.emitAdmin("maps", { action, mapId, by: adminOf(req) })

  app.get("/admin/maps", async () => pool().view())

  // Preview before adding. Nothing is stored
  app.get<{ Querystring: { q?: string } }>("/admin/maps/workshop", async (req) => {
    const p = pool()
    const item = await workshop(req.query.q ?? "")
    const current = (await p.view()).maps
    const existing = current.find((m) => m.workshopId === item.workshopId)
    let suggestedId = slugMapId(item.title)
    if (!suggestedId || current.some((m) => m.id === suggestedId)) suggestedId = `ws_${item.workshopId}`.slice(0, 48)
    return { item, suggestedId, existingId: existing?.id ?? null }
  })

  app.post("/admin/maps", async (req, reply) => {
    const p = pool()
    const body = parse(PoolMapCreateSchema, req.body)
    // Steam is asked again so the stored details never come from the browser
    const item = await workshop(body.workshop)
    const id = body.id ?? (slugMapId(item.title) || `ws_${item.workshopId}`)
    if (!PoolMapIdSchema.safeParse(id).success) throw new AdminError(400, "invalid_request", "Pick a map id")
    const by = adminOf(req)
    const map = await guard(() =>
      p.add(
        {
          id,
          displayName: body.displayName ?? item.title.slice(0, 40),
          ...(body.mapName ? { mapName: body.mapName } : {}),
          modes: body.modes,
          ...(body.loadout ? { loadout: body.loadout } : {}),
          workshop: item,
        },
        by,
      ),
    )
    const entry = await store.writeAudit({
      adminSteamId: by,
      action: "map.add",
      target: map.id,
      payload: { workshopId: item.workshopId, title: item.title, modes: map.modes, loadout: map.loadout },
    })
    changed(req, "added", map.id)
    return reply.code(201).send({ map, audit: entry })
  })

  app.patch<{ Params: { id: string } }>("/admin/maps/:id", async (req) => {
    const p = pool()
    checkId(req.params.id)
    const patch = parse(PoolMapPatchSchema, req.body ?? {})
    const by = adminOf(req)
    const { before, after } = await guard(() => p.update(req.params.id, patch, by))
    const entry = await store.writeAudit({
      adminSteamId: by,
      action: "map.update",
      target: after.id,
      payload: {
        patch,
        before: { displayName: before.displayName, modes: before.modes, loadout: before.loadout },
      },
    })
    changed(req, "updated", after.id)
    return { map: after, audit: entry }
  })

  app.put("/admin/maps/order", async (req) => {
    const p = pool()
    const { ids } = parse(PoolOrderSchema, req.body)
    const by = adminOf(req)
    const maps = await guard(() => p.reorder(ids, by))
    const entry = await store.writeAudit({ adminSteamId: by, action: "map.reorder", target: "map_pool", payload: { ids } })
    changed(req, "reordered", "")
    return { maps, audit: entry }
  })

  app.delete<{ Params: { id: string } }>("/admin/maps/:id", async (req) => {
    const p = pool()
    checkId(req.params.id)
    const by = adminOf(req)
    const removed = await guard(() => p.remove(req.params.id, by))
    const entry = await store.writeAudit({
      adminSteamId: by,
      action: "map.remove",
      target: removed.id,
      payload: { workshopId: removed.workshopId, displayName: removed.displayName },
    })
    changed(req, "removed", removed.id)
    return { ok: true, audit: entry }
  })
}
