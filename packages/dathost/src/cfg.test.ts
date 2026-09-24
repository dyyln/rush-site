import { launchFixture, MODES, PluginMatchConfigSchema, resolveLaunch, getModeConfig, type StartServerRequest } from "@rushsite/shared"
import { describe, expect, it } from "vitest"
import { buildMatchJson, buildModeCfg, consoleSwitchLines, dathostGameMode } from "./cfg.js"

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

describe("match.json", () => {
  it("passes the series block through to the plugin", () => {
    const maps = getModeConfig("aim1v1").maps.slice(0, 3)
    const up = (n: number) => ({ bucket: "b", key: `k_m${n}.dem`, presignedPutUrl: `https://s3.test/${n}` })
    const req: StartServerRequest = {
      matchId: "5f0c7a3e-1b2c-4d5e-8f90-1234567890ab",
      mode: "aim1v1",
      map: maps[0]!,
      gslt: "",
      password: "abc123",
      allowedSteamIds: ["76561198000000001", "76561198000000002"],
      teams: [
        { name: "A", steamIds: ["76561198000000001"] },
        { name: "B", steamIds: ["76561198000000002"] },
      ],
      webhookUrl: "https://api.test/webhooks/match/x",
      webhookSecret: "s".repeat(32),
      demoUpload: up(1),
      cs2: resolveLaunch("aim1v1", maps[0]!),
      series: { bestOf: 3, maps, startMapNumber: 1, wins: { A: 0, B: 0 }, demoUploads: [up(1), up(2), up(3)] },
    }
    const json = PluginMatchConfigSchema.parse(buildMatchJson(req))
    expect(json.series?.maps.map((m) => m.id)).toEqual(maps.map((m) => m.id))
    expect(json.series?.demoUploads[2]!.key).toBe("k_m3.dem")
    const { series: _s, ...single } = req
    expect(buildMatchJson(single)).not.toHaveProperty("series")
  })
})
