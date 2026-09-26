import { eq } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Db } from "../../db/client.js"
import { ApiError } from "../../lib/errors.js"
import type { ActivityService } from "../activity/service.js"
import { DiscordError, snowflakeTime, type DiscordApi } from "./client.js"
import { discordLinks } from "./schema.js"

export type DiscordLinkView = {
  discordId: string
  username: string
  globalName: string | null
  avatarUrl: string | null
  discordCreatedAt: string
  linkedAt: string
  roleGranted: boolean
  syncedAt: string | null
  syncError: string | null
}

export type DiscordStatus = { enabled: boolean; inviteUrl: string | null; link: DiscordLinkView | null }

export type LinkResult = { link: DiscordLinkView; joined: boolean }

type Row = typeof discordLinks.$inferSelect

// A player who is not in the server yet. Joining with the invite later needs a resync
export const NOT_IN_SERVER = "not_in_server"

function view(r: Row): DiscordLinkView {
  return {
    discordId: r.discordId,
    username: r.username,
    globalName: r.globalName,
    avatarUrl: r.avatar ? `https://cdn.discordapp.com/avatars/${r.discordId}/${r.avatar}.png?size=64` : null,
    discordCreatedAt: r.discordCreatedAt.toISOString(),
    linkedAt: r.linkedAt.toISOString(),
    roleGranted: r.roleGranted,
    syncedAt: r.syncedAt?.toISOString() ?? null,
    syncError: r.syncError,
  }
}

function errorText(err: unknown): string {
  if (err instanceof DiscordError) return err.unknownMember ? NOT_IN_SERVER : `discord ${err.status}: ${err.message}`.slice(0, 200)
  return "discord unreachable"
}

export type DiscordDeps = {
  db: Db
  // Null while Discord is not configured
  api: DiscordApi | null
  inviteUrl: string | null
  isBanned: (steamId: string) => Promise<boolean>
  activity: ActivityService
  log: FastifyBaseLogger
  now: () => number
}

// Links a Discord account to a player and keeps the Linked role in step with bans
export class DiscordService {
  constructor(private readonly deps: DiscordDeps) {}

  get enabled(): boolean {
    return this.deps.api !== null
  }

  private get api(): DiscordApi {
    if (!this.deps.api) throw new ApiError(404, "discord_disabled", "Discord linking is not set up")
    return this.deps.api
  }

  private async row(steamId: string): Promise<Row | undefined> {
    return (await this.deps.db.select().from(discordLinks).where(eq(discordLinks.steamId, steamId)))[0]
  }

  async status(steamId: string): Promise<DiscordStatus> {
    const r = await this.row(steamId)
    return { enabled: this.enabled, inviteUrl: this.deps.inviteUrl, link: r ? view(r) : null }
  }

  async linkOf(steamId: string): Promise<DiscordLinkView | null> {
    const r = await this.row(steamId)
    return r ? view(r) : null
  }

  // Finishes the OAuth flow. Adds the player to the server when they are not in it yet
  async link(steamId: string, code: string): Promise<LinkResult> {
    const api = this.api
    const token = await api.exchangeCode(code)
    try {
      const user = await api.me(token)
      const [owner] = await this.deps.db
        .select({ steamId: discordLinks.steamId })
        .from(discordLinks)
        .where(eq(discordLinks.discordId, user.id))
      if (owner && owner.steamId !== steamId) throw new ApiError(409, "discord_taken", "That Discord account is linked to another player")

      const previous = await this.row(steamId)
      if (previous && previous.discordId !== user.id) await this.dropRole(previous.discordId)

      const now = new Date(this.deps.now())
      const fields = {
        discordId: user.id,
        username: user.username,
        globalName: user.global_name,
        avatar: user.avatar,
        discordCreatedAt: snowflakeTime(user.id),
      }
      await this.deps.db
        .insert(discordLinks)
        .values({ steamId, ...fields, linkedAt: now })
        .onConflictDoUpdate({ target: discordLinks.steamId, set: { ...fields, linkedAt: now } })

      let joined = false
      let roleGranted = false
      let syncError: string | null = null
      if (!(await this.deps.isBanned(steamId))) {
        try {
          joined = await api.addMember(user.id, token)
          // An existing member keeps their roles, so the role goes on separately
          if (!joined) await api.addRole(user.id)
          roleGranted = true
        } catch (err) {
          syncError = errorText(err)
          this.deps.log.warn({ err, steamId }, "discord role grant failed")
        }
      }
      await this.deps.db.update(discordLinks).set({ roleGranted, syncError, syncedAt: now }).where(eq(discordLinks.steamId, steamId))
      if (!previous || previous.discordId !== user.id) {
        this.deps.activity.record([steamId], { kind: "discord_link", ref: user.id, detail: joined ? "joined" : null })
      }
      return { link: view((await this.row(steamId))!), joined }
    } finally {
      // The token was only needed for this request
      void api.revoke(token).catch(() => undefined)
    }
  }

  async unlink(steamId: string): Promise<boolean> {
    const r = await this.row(steamId)
    if (!r) return false
    if (this.enabled) await this.dropRole(r.discordId)
    await this.deps.db.delete(discordLinks).where(eq(discordLinks.steamId, steamId))
    this.deps.activity.record([steamId], { kind: "discord_unlink", ref: r.discordId })
    return true
  }

  // Gives or takes the Linked role depending on whether the player is banned
  async sync(steamId: string): Promise<DiscordLinkView | null> {
    const r = await this.row(steamId)
    if (!r || !this.enabled) return r ? view(r) : null
    const api = this.api
    const want = !(await this.deps.isBanned(steamId))
    let roleGranted = r.roleGranted
    let syncError: string | null = null
    try {
      if (want) await api.addRole(r.discordId)
      else await api.removeRole(r.discordId)
      roleGranted = want
    } catch (err) {
      syncError = errorText(err)
      // A member who left has no roles
      if (err instanceof DiscordError && err.unknownMember) roleGranted = false
      else this.deps.log.warn({ err, steamId }, "discord role sync failed")
    }
    await this.deps.db
      .update(discordLinks)
      .set({ roleGranted, syncError, syncedAt: new Date(this.deps.now()) })
      .where(eq(discordLinks.steamId, steamId))
    return view((await this.row(steamId))!)
  }

  // For ban changes and sign ins. Never throws
  syncQuietly(steamId: string): void {
    if (!this.enabled) return
    void this.sync(steamId).catch((err: unknown) => this.deps.log.warn({ err, steamId }, "discord sync failed"))
  }

  private async dropRole(discordId: string): Promise<void> {
    try {
      await this.api.removeRole(discordId)
    } catch (err) {
      if (!(err instanceof DiscordError && err.unknownMember)) this.deps.log.warn({ err, discordId }, "discord role removal failed")
    }
  }
}
