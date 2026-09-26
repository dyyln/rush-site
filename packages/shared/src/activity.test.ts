import { describe, expect, it } from "vitest"
import { pageRoute } from "./activity.js"

describe("pageRoute", () => {
  it("maps paths to routes and keeps the id", () => {
    expect(pageRoute("/")).toEqual({ route: "/", ref: null })
    expect(pageRoute("/play?x=1")).toEqual({ route: "/play", ref: null })
    expect(pageRoute("/matches/brave-otter-42")).toEqual({ route: "/matches/[id]", ref: "brave-otter-42" })
    expect(pageRoute("/profile/76561198000000001")).toEqual({ route: "/profile/[steamId]", ref: "76561198000000001" })
    expect(pageRoute("/admin/users/76561198000000001")).toEqual({ route: "/admin/users/[steamId]", ref: "76561198000000001" })
    expect(pageRoute("/admin/queue")).toEqual({ route: "/admin/queue", ref: null })
  })

  it("rejects anything that is not a site path", () => {
    expect(pageRoute("https://evil.example/")).toBeNull()
    expect(pageRoute("/a b")).toBeNull()
    expect(pageRoute(`/${"x".repeat(300)}`)).toBeNull()
  })
})
