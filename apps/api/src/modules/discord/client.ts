import type { FetchFn } from "../auth/steam.js"

const API = "https://discord.com/api/v10"
export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
// identify reads who they are. guilds.join lets the bot add them when they have not joined yet
export const DISCORD_SCOPES = ["identify", "guilds.join"]
// Discord's error code for a user who is not in the server
const UNKNOWN_MEMBER = 10007

export type DiscordConfig = {
  clientId: string
  clientSecret: string
  botToken: string
  guildId: string
  roleId: string
  redirectUri: string
}

export type DiscordUser = { id: string; username: string; global_name: string | null; avatar: string | null }

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message)
  }

  get unknownMember(): boolean {
    return this.status === 404 && this.code === UNKNOWN_MEMBER
  }
}

// The slice of Discord's REST API that linking needs
export interface DiscordApi {
  exchangeCode(code: string): Promise<string>
  me(accessToken: string): Promise<DiscordUser>
  revoke(accessToken: string): Promise<void>
  // Adds the user to the server with the role. False when they were already a member, which ignores roles
  addMember(userId: string, accessToken: string): Promise<boolean>
  addRole(userId: string): Promise<void>
  removeRole(userId: string): Promise<void>
}

export class DiscordRestApi implements DiscordApi {
  constructor(
    private readonly config: DiscordConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async call(method: string, path: string, init: { auth: string; body?: unknown; form?: URLSearchParams }): Promise<Response> {
    const headers: Record<string, string> = { authorization: init.auth, "user-agent": "DiscordBot (https://duelrush.site, 1)" }
    let body: string | undefined
    if (init.form) {
      headers["content-type"] = "application/x-www-form-urlencoded"
      body = init.form.toString()
    } else if (init.body !== undefined) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(init.body)
    }
    const res = await this.fetchFn(`${API}${path}`, { method, headers, body, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { code?: number; message?: string; error?: string }
      throw new DiscordError(res.status, data.code ?? null, data.message ?? data.error ?? `discord ${method} ${path} ${res.status}`)
    }
    return res
  }

  private get basic(): string {
    return `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`
  }

  private get bot(): string {
    return `Bot ${this.config.botToken}`
  }

  private memberPath(userId: string): string {
    return `/guilds/${this.config.guildId}/members/${userId}`
  }

  async exchangeCode(code: string): Promise<string> {
    const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri })
    const res = await this.call("POST", "/oauth2/token", { auth: this.basic, form })
    return ((await res.json()) as { access_token: string }).access_token
  }

  async me(accessToken: string): Promise<DiscordUser> {
    const res = await this.call("GET", "/users/@me", { auth: `Bearer ${accessToken}` })
    return (await res.json()) as DiscordUser
  }

  async revoke(accessToken: string): Promise<void> {
    const form = new URLSearchParams({ token: accessToken, token_type_hint: "access_token" })
    await this.call("POST", "/oauth2/token/revoke", { auth: this.basic, form })
  }

  async addMember(userId: string, accessToken: string): Promise<boolean> {
    const res = await this.call("PUT", this.memberPath(userId), {
      auth: this.bot,
      body: { access_token: accessToken, roles: [this.config.roleId] },
    })
    return res.status === 201
  }

  async addRole(userId: string): Promise<void> {
    await this.call("PUT", `${this.memberPath(userId)}/roles/${this.config.roleId}`, { auth: this.bot })
  }

  async removeRole(userId: string): Promise<void> {
    await this.call("DELETE", `${this.memberPath(userId)}/roles/${this.config.roleId}`, { auth: this.bot })
  }
}

// Discord ids are snowflakes that carry their creation time
export function snowflakeTime(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n))
}
