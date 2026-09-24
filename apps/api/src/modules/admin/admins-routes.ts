import { SteamId64Schema } from "@rushsite/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { AdminError } from "./routes.js"
import type { AdminStore } from "./store.js"
import type { AdminDirectory, AdminPluginOptions, AdminRow, AdminView, UserCard } from "./types.js"

const GrantBody = z.object({
  // Individual accounts all start with 7656119
  steamId: z.string().trim().pipe(SteamId64Schema).pipe(z.string().regex(/^7656119\d{10}$/)),
  note: z.string().trim().max(200).optional(),
})

export interface AdminsDeps {
  store: AdminStore
  opts: Pick<AdminPluginOptions, "admins" | "emitAdmin">
}

function withCard(view: AdminView, card: UserCard | undefined): AdminView {
  if (!card) return view
  return { ...view, displayName: card.displayName, ...(card.avatarUrl ? { avatarUrl: card.avatarUrl } : {}) }
}

function rowView(row: AdminRow, card: UserCard | undefined): AdminView {
  return withCard(
    {
      steamId: row.steamId,
      source: "db",
      addedBy: row.addedBy,
      ...(row.note ? { note: row.note } : {}),
      createdAt: new Date(row.createdAt).toISOString(),
    },
    card,
  )
}

export function registerAdminsRoutes(app: FastifyInstance, deps: AdminsDeps, adminOf: (req: FastifyRequest) => string) {
  const { store, opts } = deps

  const directory = (): AdminDirectory => {
    if (!opts.admins) throw new AdminError(404, "not_found", "Admin list is not available")
    return opts.admins
  }

  app.get("/admin/admins", async (): Promise<{ admins: AdminView[] }> => {
    const dir = directory()
    const roots = dir.rootIds()
    const rows = (await dir.list()).filter((r) => !roots.includes(r.steamId))
    const cards = await store.userCards([...roots, ...rows.map((r) => r.steamId)])
    return {
      admins: [
        ...roots.map((steamId) => withCard({ steamId, source: "config" }, cards.get(steamId))),
        ...rows.map((r) => rowView(r, cards.get(r.steamId))),
      ],
    }
  })

  app.post("/admin/admins", async (req, reply) => {
    const dir = directory()
    const r = GrantBody.safeParse(req.body)
    if (!r.success) throw new AdminError(400, "invalid_request", "steamId must be a SteamID64")
    const { steamId } = r.data
    const note = r.data.note || null
    if (dir.rootIds().includes(steamId)) throw new AdminError(409, "already_admin", "Already an admin from config")
    const by = adminOf(req)
    const row = await dir.grant(steamId, by, note)
    if (!row) throw new AdminError(409, "already_admin", "Already an admin")
    const entry = await store.writeAudit({ adminSteamId: by, action: "admin.grant", target: steamId, payload: { note } })
    opts.emitAdmin("user", { action: "admin_granted", steamId, by })
    const cards = await store.userCards([steamId])
    return reply.code(201).send({ admin: rowView(row, cards.get(steamId)), audit: entry })
  })

  app.delete<{ Params: { steamId: string } }>("/admin/admins/:steamId", async (req) => {
    const dir = directory()
    const { steamId } = req.params
    if (!SteamId64Schema.safeParse(steamId).success) throw new AdminError(404, "not_found", "Admin not found")
    if (dir.rootIds().includes(steamId)) {
      throw new AdminError(403, "config_admin", "Admins from ADMIN_STEAM_IDS can only be removed in config")
    }
    const by = adminOf(req)
    if (steamId === by) throw new AdminError(400, "cannot_remove_self", "You cannot remove yourself")
    const row = await dir.revoke(steamId)
    if (!row) throw new AdminError(404, "not_found", "Admin not found")
    const entry = await store.writeAudit({
      adminSteamId: by,
      action: "admin.revoke",
      target: steamId,
      payload: { addedBy: row.addedBy, note: row.note },
    })
    opts.emitAdmin("user", { action: "admin_revoked", steamId, by })
    return { ok: true, audit: entry }
  })
}
