import type { FastifyInstance, FastifyRequest } from "fastify"
import { AdminError } from "./routes.js"
import type { AdminStore } from "./store.js"
import type { AdminPluginOptions, DiscordLike } from "./types.js"

const STEAM_ID = /^\d{17}$/

export function registerDiscordAdminRoutes(
  app: FastifyInstance,
  deps: { store: AdminStore; opts: Pick<AdminPluginOptions, "discord" | "emitAdmin"> },
  adminOf: (req: FastifyRequest) => string,
): void {
  const { store, opts } = deps
  const discord = (): DiscordLike => {
    if (!opts.discord) throw new AdminError(404, "not_found", "Not found")
    return opts.discord
  }
  const checked = (steamId: string) => {
    if (!STEAM_ID.test(steamId)) throw new AdminError(404, "not_found", "User not found")
    return steamId
  }

  app.get<{ Params: { steamId: string } }>("/admin/users/:steamId/discord", async (req) => {
    const d = discord()
    return { enabled: d.enabled, link: await d.linkOf(checked(req.params.steamId)) }
  })

  app.post<{ Params: { steamId: string } }>("/admin/users/:steamId/discord/unlink", async (req) => {
    const steamId = checked(req.params.steamId)
    const before = await discord().linkOf(steamId)
    if (!before || !(await discord().unlink(steamId))) throw new AdminError(409, "not_linked", "No Discord account is linked")
    const entry = await store.writeAudit({
      adminSteamId: adminOf(req),
      action: "user.discord_unlink",
      target: steamId,
      payload: { discordId: before.discordId, username: before.username },
    })
    opts.emitAdmin("user", { action: "discord_unlinked", steamId, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })

  app.post<{ Params: { steamId: string } }>("/admin/users/:steamId/discord/sync", async (req) => {
    const steamId = checked(req.params.steamId)
    const d = discord()
    if (!d.enabled) throw new AdminError(409, "discord_disabled", "Discord linking is not set up")
    const link = await d.sync(steamId)
    if (!link) throw new AdminError(409, "not_linked", "No Discord account is linked")
    const entry = await store.writeAudit({
      adminSteamId: adminOf(req),
      action: "user.discord_sync",
      target: steamId,
      payload: { roleGranted: link.roleGranted, error: link.syncError },
    })
    return { ok: true, link, audit: entry }
  })
}
