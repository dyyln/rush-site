import type { WorkshopItem } from "@rushsite/shared"
import type { FetchFn } from "../auth/steam.js"

const DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/"
const CS2_APP_ID = 730
// Previews are only kept when they are served from Steam's own CDN
const PREVIEW_HOST_RE = /^(images\.steamusercontent\.com|steamuserimages-a\.akamaihd\.net|[a-z0-9.-]+\.steamstatic\.com)$/i

export class WorkshopError extends Error {
  constructor(
    readonly code: "not_found" | "not_cs2" | "not_a_map" | "steam_unavailable",
    message: string,
  ) {
    super(message)
  }
}

type RawDetails = {
  publishedfileid?: string
  result?: number
  title?: string
  preview_url?: string
  creator?: string
  file_size?: string | number
  consumer_app_id?: number
  creator_app_id?: number
  time_created?: number
  time_updated?: number
  subscriptions?: number
  lifetime_subscriptions?: number
  banned?: number | boolean
  visibility?: number
  tags?: { tag?: string }[]
}

function safePreview(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "https:" && PREVIEW_HOST_RE.test(u.hostname) ? u.toString() : null
  } catch {
    return null
  }
}

const isoFromUnix = (t: number | undefined) => (t && t > 0 ? new Date(t * 1000).toISOString() : null)

function toInt(v: string | number | undefined): number | null {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

// Reads one Workshop item from Steam. No API key is needed for this call
export async function fetchWorkshopItem(
  fetchFn: FetchFn,
  workshopId: string,
  creatorName?: (steamId: string) => Promise<string | null>,
): Promise<WorkshopItem> {
  const body = new URLSearchParams({ itemcount: "1", "publishedfileids[0]": workshopId })
  let raw: RawDetails | undefined
  try {
    const res = await fetchFn(DETAILS_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const json = (await res.json()) as { response?: { publishedfiledetails?: RawDetails[] } }
    raw = json.response?.publishedfiledetails?.[0]
  } catch (err) {
    throw new WorkshopError("steam_unavailable", `Steam did not answer: ${(err as Error).message}`)
  }
  if (!raw || raw.result !== 1 || raw.publishedfileid !== workshopId) {
    throw new WorkshopError("not_found", "No public Workshop item with that id")
  }
  if (raw.banned === 1 || raw.banned === true) throw new WorkshopError("not_found", "That Workshop item is banned")
  if (raw.consumer_app_id !== CS2_APP_ID) throw new WorkshopError("not_cs2", "That Workshop item is not for Counter-Strike")
  const tags = (raw.tags ?? []).map((t) => t.tag ?? "").filter(Boolean)
  if (!tags.some((t) => t.toLowerCase() === "map")) throw new WorkshopError("not_a_map", "That Workshop item is not tagged as a map")
  const creatorSteamId = raw.creator && /^\d{17}$/.test(raw.creator) ? raw.creator : null
  let name: string | null = null
  if (creatorSteamId && creatorName) name = await creatorName(creatorSteamId).catch(() => null)
  return {
    workshopId,
    title: (raw.title ?? "").trim().slice(0, 200) || workshopId,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`,
    previewUrl: safePreview(raw.preview_url),
    creatorSteamId,
    creatorName: name,
    fileSize: toInt(raw.file_size),
    tags,
    createdAt: isoFromUnix(raw.time_created),
    updatedAt: isoFromUnix(raw.time_updated),
    subscriptions: toInt(raw.lifetime_subscriptions ?? raw.subscriptions),
    cs2: tags.some((t) => t.toLowerCase() === "cs2"),
  }
}
