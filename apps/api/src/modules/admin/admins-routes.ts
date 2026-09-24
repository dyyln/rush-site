import { SteamId64Schema } from "@rushsite/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { parseProfileInput } from "./ops-routes.js"
import { AdminError } from "./routes.js"
import type { AdminStore } from "./store.js"
import type {
  AdminCandidateView,
  AdminDirectory,
  AdminListView,
  AdminPluginOptions,
  AdminRow,
  AdminView,
  SteamProfileCard,
  UserCard,
} from "./types.js"

// Individual accounts all start with 7656119
const IndividualSteamId = SteamId64Schema.pipe(z.string().regex(/^7656119\d{10}$/))

const GrantBody = z.object({
  steamId: z.string().trim().pipe(IndividualSteamId),
  note: z.string().trim().max(200).optional(),
})

export interface AdminsDeps {
  store: AdminStore
  opts: Pick<AdminPluginOptions, "admins" | "emitAdmin" | "resolveVanity" | "steamProfiles" | "onAdminChanged">
}

// Who may add and remove admins. Every other admin can only view the list
export function canManageAdmins(dir: Pick<AdminDirectory, "rootIds">, actorSteamId: string): boolean {
  return dir.rootIds().includes(actorSteamId)
}

type Names = Map<string, { displayName: string; avatarUrl: string | null; signedIn: boolean; profileUrl: string | null }>

export function registerAdminsRoutes(app: FastifyInstance, deps: AdminsDeps, adminOf: (req: FastifyRequest) => string) {
  const { store, opts } = deps

  const directory = (): AdminDirectory => {
    if (!opts.admins) throw new AdminError(404, "not_found", "Admin list is not available")
    return opts.admins
  }

  const requireManager = (dir: AdminDirectory, actor: string) => {
    if (!canManageAdmins(dir, actor)) {
      throw new AdminError(403, "super_admin_only", "Only super admins can add or remove admins")
    }
  }

  // User rows first, then Steam for ids that never signed in. Steam errors leave the id unnamed
  const names = async (steamIds: string[]): Promise<Names> => {
    const out: Names = new Map()
    const cards: Map<string, UserCard> = await store.userCards(steamIds)
    for (const [id, c] of cards) out.set(id, { displayName: c.displayName, avatarUrl: c.avatarUrl, signedIn: true, profileUrl: null })
    const missing = [...new Set(steamIds)].filter((id) => !out.has(id))
    if (missing.length > 0 && opts.steamProfiles) {
      let found: SteamProfileCard[] = []
      try {
        found = await opts.steamProfiles(missing)
      } catch (err) {
        app.log.warn({ err }, "steam profile lookup for admins failed")
      }
      for (const p of found) {
        if (missing.includes(p.steamId)) out.set(p.steamId, { ...p, signedIn: false })
      }
    }
    return out
  }

  const view = (
    steamId: string,
    isSuper: boolean,
    row: AdminRow | null,
    known: Names,
  ): AdminView => {
    const n = known.get(steamId)
    const by = row ? known.get(row.addedBy) : undefined
    return {
      steamId,
      ...(n ? { displayName: n.displayName } : {}),
      ...(n?.avatarUrl ? { avatarUrl: n.avatarUrl } : {}),
      signedIn: n?.signedIn ?? false,
      super: isSuper,
      source: isSuper ? "config" : "db",
      ...(row
        ? {
            addedBy: row.addedBy,
            ...(by ? { addedByName: by.displayName } : {}),
            ...(row.note ? { note: row.note } : {}),
            createdAt: new Date(row.createdAt).toISOString(),
          }
        : {}),
    }
  }

  app.get("/admin/admins", async (req): Promise<AdminListView> => {
    const dir = directory()
    const me = adminOf(req)
    const roots = dir.rootIds()
    const rows = (await dir.list()).filter((r) => !roots.includes(r.steamId))
    const known = await names([...roots, ...rows.flatMap((r) => [r.steamId, r.addedBy])])
    return {
      admins: [...roots.map((id) => view(id, true, null, known)), ...rows.map((r) => view(r.steamId, false, r, known))],
      viewer: { steamId: me, super: roots.includes(me), canManage: canManageAdmins(dir, me) },
    }
  })

  // Resolves a SteamID64 or profile URL so the add form can show who it is
  app.get<{ Querystring: { q?: string } }>("/admin/admins/lookup", async (req): Promise<AdminCandidateView> => {
    const dir = directory()
    const parsed = parseProfileInput(req.query.q ?? "")
    if (!parsed) throw new AdminError(400, "invalid_request", "Enter a SteamID64 or a steamcommunity.com profile URL")
    let steamId = "steamId" in parsed ? parsed.steamId : null
    if (!steamId && "vanity" in parsed) {
      steamId = opts.resolveVanity ? await opts.resolveVanity(parsed.vanity).catch(() => null) : null
      if (!steamId) throw new AdminError(404, "not_found", `Could not resolve the custom URL ${parsed.vanity}`)
    }
    if (!IndividualSteamId.safeParse(steamId).success) {
      throw new AdminError(400, "invalid_request", "That is not a SteamID64 of a player account")
    }
    const id = steamId!
    const n = (await names([id])).get(id)
    const isAdmin = dir.rootIds().includes(id) ? "super" : (await dir.list()).some((r) => r.steamId === id) ? "admin" : null
    return {
      steamId: id,
      ...(n ? { displayName: n.displayName } : {}),
      ...(n?.avatarUrl ? { avatarUrl: n.avatarUrl } : {}),
      profileUrl: n?.profileUrl ?? `https://steamcommunity.com/profiles/${id}`,
      signedIn: n?.signedIn ?? false,
      admin: isAdmin,
    }
  })

  app.post("/admin/admins", async (req, reply) => {
    const dir = directory()
    const by = adminOf(req)
    requireManager(dir, by)
    const r = GrantBody.safeParse(req.body)
    if (!r.success) throw new AdminError(400, "invalid_request", "steamId must be a SteamID64")
    const { steamId } = r.data
    const note = r.data.note || null
    if (dir.rootIds().includes(steamId)) throw new AdminError(409, "already_admin", "Already a super admin")
    const row = await dir.grant(steamId, by, note)
    if (!row) throw new AdminError(409, "already_admin", "Already an admin")
    const entry = await store.writeAudit({ adminSteamId: by, action: "admin.grant", target: steamId, payload: { note } })
    opts.onAdminChanged?.(steamId, true)
    opts.emitAdmin("user", { action: "admin_granted", steamId, by })
    const known = await names([steamId, by])
    return reply.code(201).send({ admin: view(steamId, false, row, known), audit: entry })
  })

  app.delete<{ Params: { steamId: string } }>("/admin/admins/:steamId", async (req) => {
    const dir = directory()
    const by = adminOf(req)
    requireManager(dir, by)
    const { steamId } = req.params
    if (!SteamId64Schema.safeParse(steamId).success) throw new AdminError(404, "not_found", "Admin not found")
    if (steamId === by) throw new AdminError(400, "cannot_remove_self", "You cannot remove yourself")
    if (dir.rootIds().includes(steamId)) {
      throw new AdminError(403, "super_admin", "Super admins come from ADMIN_STEAM_IDS and can only be removed there")
    }
    const row = await dir.revoke(steamId)
    if (!row) throw new AdminError(404, "not_found", "Admin not found")
    const entry = await store.writeAudit({
      adminSteamId: by,
      action: "admin.revoke",
      target: steamId,
      payload: { addedBy: row.addedBy, note: row.note },
    })
    opts.onAdminChanged?.(steamId, false)
    opts.emitAdmin("user", { action: "admin_revoked", steamId, by })
    return { ok: true, audit: entry }
  })
}
