import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MODES } from "../schemas/mode.js"
import { launchFixture, launchFixtureJson, MODES_FIXTURE_PATH } from "./launch-export.js"
import { agentExecCfgs, MODE_CONFIGS, resolveLaunch, unresolvedConfig } from "./modes.js"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")

describe("launch config export", () => {
  it("agent/testdata/modes.json is up to date", () => {
    const onDisk = readFileSync(resolve(repo, MODES_FIXTURE_PATH), "utf8")
    // Run `pnpm -C packages/shared export:modes` when this fails
    expect(onDisk).toBe(launchFixtureJson())
  })

  it("names only cfgs the agent ships", () => {
    for (const name of agentExecCfgs()) {
      expect(existsSync(resolve(repo, "agent/internal/match/cfgs", name)), name).toBe(true)
    }
  })

  it("resolves one map target per launch", () => {
    for (const mode of MODES) {
      expect(unresolvedConfig(mode)).toEqual([])
      for (const l of launchFixture().modes[mode]!.launches) {
        expect(Object.hasOwn(l.cs2, "workshopId") !== Object.hasOwn(l.cs2, "mapName")).toBe(true)
      }
    }
    expect(resolveLaunch("rush3v3", MODE_CONFIGS.rush3v3.maps[0]!)).toEqual({
      gameType: 0,
      gameMode: 6,
      execCfg: "rushsite_rush3v3.cfg",
      mapName: "rush_001",
    })
    expect(resolveLaunch("aim1v1", MODE_CONFIGS.aim1v1.maps[0]!)).toEqual({
      gameType: 0,
      gameMode: 1,
      execCfg: "rushsite_aim1v1.cfg",
      workshopId: "3084291314",
    })
  })
})
