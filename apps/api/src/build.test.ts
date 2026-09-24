import { describe, expect, it } from "vitest"
import { buildInfo } from "./build.js"

describe("buildInfo", () => {
  it("reads the stamp baked into the image", () => {
    expect(
      buildInfo({ BUILD_SHA: "652cedf1a2b3", BUILD_SUBJECT: "Backdrop parallax toned down", BUILD_TIME: "2026-09-24T21:30:00Z" }),
    ).toEqual({ sha: "652cedf1a2b3", subject: "Backdrop parallax toned down", builtAt: "2026-09-24T21:30:00Z" })
  })

  it("is all null outside a deployed build, where the args are empty", () => {
    expect(buildInfo({ BUILD_SHA: "", BUILD_SUBJECT: " " })).toEqual({ sha: null, subject: null, builtAt: null })
  })
})
