import { describe, expect, it } from "vitest"
import { fetchWorkshopItem, WorkshopError } from "./workshop.js"

const ITEM = {
  publishedfileid: "3070290869",
  result: 1,
  creator: "76561198052148850",
  consumer_app_id: 730,
  title: "awp_india",
  preview_url: "https://images.steamusercontent.com/ugc/2206261644182514279/6C18F04179B063B46A8C976BCF55F6BC5BCA845E/",
  file_size: "83763796",
  time_created: 1698976695,
  time_updated: 1699419831,
  lifetime_subscriptions: 60000,
  banned: 0,
  tags: [{ tag: "Custom" }, { tag: "Map" }, { tag: "Cs2" }],
}

function fakeFetch(details: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ response: { result: 1, resultcount: 1, publishedfiledetails: [details] } }), { status })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe("fetchWorkshopItem", () => {
  it("posts the id to GetPublishedFileDetails and maps the answer", async () => {
    const { fn, calls } = fakeFetch(ITEM)
    const item = await fetchWorkshopItem(fn, "3070290869", async () => "Geno")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/")
    expect(calls[0]!.init?.method).toBe("POST")
    expect(new URLSearchParams(String(calls[0]!.init?.body)).get("publishedfileids[0]")).toBe("3070290869")
    expect(item).toEqual({
      workshopId: "3070290869",
      title: "awp_india",
      url: "https://steamcommunity.com/sharedfiles/filedetails/?id=3070290869",
      previewUrl: ITEM.preview_url,
      creatorSteamId: "76561198052148850",
      creatorName: "Geno",
      fileSize: 83763796,
      tags: ["Custom", "Map", "Cs2"],
      createdAt: new Date(1698976695000).toISOString(),
      updatedAt: new Date(1699419831000).toISOString(),
      subscriptions: 60000,
      cs2: true,
    })
  })

  it("drops a preview that is not on Steam's CDN", async () => {
    const { fn } = fakeFetch({ ...ITEM, preview_url: "https://evil.example/x.png" })
    expect((await fetchWorkshopItem(fn, "3070290869")).previewUrl).toBeNull()
    const { fn: http } = fakeFetch({ ...ITEM, preview_url: "http://images.steamusercontent.com/ugc/1/" })
    expect((await fetchWorkshopItem(http, "3070290869")).previewUrl).toBeNull()
  })

  it("keeps going when the creator name lookup fails", async () => {
    const { fn } = fakeFetch(ITEM)
    const item = await fetchWorkshopItem(fn, "3070290869", async () => {
      throw new Error("no key")
    })
    expect(item.creatorName).toBeNull()
  })

  it("rejects missing, foreign and non map items", async () => {
    const cases: [unknown, WorkshopError["code"]][] = [
      [{ publishedfileid: "3070290869", result: 9 }, "not_found"],
      [{ ...ITEM, banned: 1 }, "not_found"],
      [{ ...ITEM, consumer_app_id: 440 }, "not_cs2"],
      [{ ...ITEM, tags: [{ tag: "Cs2" }, { tag: "Mod" }] }, "not_a_map"],
    ]
    for (const [details, code] of cases) {
      const { fn } = fakeFetch(details)
      await expect(fetchWorkshopItem(fn, "3070290869")).rejects.toMatchObject({ code })
    }
  })

  it("reports Steam errors as unavailable", async () => {
    const { fn } = fakeFetch(ITEM, 503)
    await expect(fetchWorkshopItem(fn, "3070290869")).rejects.toMatchObject({ code: "steam_unavailable" })
    const broken = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    await expect(fetchWorkshopItem(broken, "3070290869")).rejects.toBeInstanceOf(WorkshopError)
  })
})
