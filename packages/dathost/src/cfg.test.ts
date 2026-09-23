import { launchFixture, MODES } from "@rushsite/shared"
import { describe, expect, it } from "vitest"
import { buildModeCfg, consoleSwitchLines, dathostGameMode } from "./cfg.js"

describe("shared launch config", () => {
  it("maps every mode and map from the shared cs2 block", () => {
    for (const mode of MODES) {
      for (const { cs2 } of launchFixture().modes[mode]!.launches) {
        const preset = dathostGameMode(cs2)
        expect(preset.preset).toBe(mode === "rush3v3" ? "custom" : "competitive")
        const target = cs2.workshopId ? `host_workshop_map ${cs2.workshopId}` : `changelevel ${cs2.mapName}`
        expect(consoleSwitchLines(cs2)).toEqual([`game_type ${cs2.gameType}`, `game_mode ${cs2.gameMode}`, target])
        expect(buildModeCfg(cs2)).toContain(`exec ${cs2.execCfg}\n`)
      }
    }
  })
})
