export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login"
const OPENID_NS = "http://specs.openid.net/auth/2.0"
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select"
const CLAIMED_ID_RE = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})\/?$/
const STEAM_API = "https://api.steampowered.com"
const CS2_APP_ID = 730

export type FetchFn = typeof fetch

export function buildLoginUrl(realm: string, returnTo: string): string {
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  })
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`
}

export type OpenIdCheck =
  | { ok: true; steamId: string; nonce: string }
  | { ok: false; reason: string }

// Local checks before asking Steam. The nonce carries a UTC timestamp prefix
export function checkAssertion(
  query: Record<string, string | undefined>,
  expectedReturnTo: string,
  now: number,
  maxAgeMs = 5 * 60 * 1000,
): OpenIdCheck {
  if (query["openid.mode"] !== "id_res") return { ok: false, reason: "mode" }
  if (query["openid.ns"] !== OPENID_NS) return { ok: false, reason: "ns" }
  if (query["openid.op_endpoint"] !== STEAM_OPENID_ENDPOINT) return { ok: false, reason: "op_endpoint" }
  const returnTo = query["openid.return_to"]
  if (!returnTo || !sameEndpoint(returnTo, expectedReturnTo)) return { ok: false, reason: "return_to" }
  const claimed = query["openid.claimed_id"]
  if (!claimed || claimed !== query["openid.identity"]) return { ok: false, reason: "identity" }
  const m = CLAIMED_ID_RE.exec(claimed)
  if (!m) return { ok: false, reason: "claimed_id" }
  const signed = (query["openid.signed"] ?? "").split(",")
  for (const field of ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce", "assoc_handle"]) {
    if (!signed.includes(field)) return { ok: false, reason: `unsigned_${field}` }
  }
  const nonce = query["openid.response_nonce"]
  if (!nonce) return { ok: false, reason: "nonce" }
  const issued = Date.parse(nonce.slice(0, 20))
  if (!Number.isFinite(issued) || Math.abs(now - issued) > maxAgeMs) return { ok: false, reason: "nonce_age" }
  return { ok: true, steamId: m[1]!, nonce }
}

function sameEndpoint(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    if (ua.origin !== ub.origin || ua.pathname !== ub.pathname) return false
    for (const [k, v] of ub.searchParams) if (ua.searchParams.get(k) !== v) return false
    return true
  } catch {
    return false
  }
}

// Asks Steam to confirm the signature. This is the step that makes the login trustworthy
export async function verifyWithSteam(query: Record<string, string | undefined>, fetchFn: FetchFn = fetch): Promise<boolean> {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (k.startsWith("openid.") && typeof v === "string") body.set(k, v)
  }
  body.set("openid.mode", "check_authentication")
  const res = await fetchFn(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/plain" },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return false
  const text = await res.text()
  return /^is_valid\s*:\s*true\s*$/m.test(text)
}

export type SteamSummary = {
  steamid: string
  personaname: string
  profileurl?: string
  avatar?: string
  avatarmedium?: string
  avatarfull?: string
  communityvisibilitystate?: number
  timecreated?: number
  loccountrycode?: string
}

export type SteamBans = {
  SteamId: string
  CommunityBanned: boolean
  VACBanned: boolean
  NumberOfVACBans: number
  DaysSinceLastBan: number
  NumberOfGameBans: number
  EconomyBan: string
}

export type SteamFriend = { steamid: string; relationship: string; friend_since: number }

export class SteamApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

// Thin Steam Web API client. Every method returns null when no key is configured
export class SteamWebApi {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  get enabled(): boolean {
    return !!this.apiKey
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T | null> {
    if (!this.apiKey) return null
    const qs = new URLSearchParams({ key: this.apiKey, format: "json", ...params })
    const res = await this.fetchFn(`${STEAM_API}${path}?${qs.toString()}`, { signal: AbortSignal.timeout(10_000) })
    // Private profiles answer 401 on friend lists
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) throw new SteamApiError(`steam api ${path} returned ${res.status}`, res.status)
    return (await res.json()) as T
  }

  async playerSummaries(steamIds: string[]): Promise<SteamSummary[]> {
    const out: SteamSummary[] = []
    for (let i = 0; i < steamIds.length; i += 100) {
      const chunk = steamIds.slice(i, i + 100)
      const r = await this.get<{ response?: { players?: SteamSummary[] } }>("/ISteamUser/GetPlayerSummaries/v2/", {
        steamids: chunk.join(","),
      })
      out.push(...(r?.response?.players ?? []))
    }
    return out
  }

  async playerBans(steamId: string): Promise<SteamBans | null> {
    const r = await this.get<{ players?: SteamBans[] }>("/ISteamUser/GetPlayerBans/v1/", { steamids: steamId })
    return r?.players?.[0] ?? null
  }

  async friendList(steamId: string): Promise<SteamFriend[] | null> {
    const r = await this.get<{ friendslist?: { friends?: SteamFriend[] } }>("/ISteamUser/GetFriendList/v1/", {
      steamid: steamId,
      relationship: "friend",
    })
    if (!r) return null
    return r.friendslist?.friends ?? []
  }

  // Minutes played. null when the library is private
  async cs2Playtime(steamId: string): Promise<number | null> {
    const r = await this.get<{ response?: { games?: { appid: number; playtime_forever: number }[] } }>(
      "/IPlayerService/GetOwnedGames/v1/",
      { steamid: steamId, include_played_free_games: "1", "appids_filter[0]": String(CS2_APP_ID) },
    )
    const games = r?.response?.games
    if (!games) return null
    return games.find((g) => g.appid === CS2_APP_ID)?.playtime_forever ?? 0
  }
}
