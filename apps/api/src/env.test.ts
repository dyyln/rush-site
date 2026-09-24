import { describe, expect, it } from "vitest"
import { testEnv } from "./env.js"

describe("RUSH_ROOM_VETO", () => {
  // Compose passes the variable as an empty string when .env leaves it out
  it("treats empty like unset so the shared config default applies", () => {
    expect(testEnv({ RUSH_ROOM_VETO: "" }).RUSH_ROOM_VETO).toBeUndefined()
    expect(testEnv().RUSH_ROOM_VETO).toBeUndefined()
  })

  it("turns the veto on or off when set", () => {
    expect(testEnv({ RUSH_ROOM_VETO: "true" }).RUSH_ROOM_VETO).toBe(true)
    expect(testEnv({ RUSH_ROOM_VETO: "false" }).RUSH_ROOM_VETO).toBe(false)
  })
})
