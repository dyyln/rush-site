import { MODES, type Mode } from "../schemas/mode.js"
import { agentExecCfgs, MODE_CONFIGS, resolveLaunch } from "./modes.js"

// Repo path of the generated fixture the Go agent tests read
export const MODES_FIXTURE_PATH = "agent/testdata/modes.json"

// Resolved launch config per mode and map. The agent tests render every entry
export function launchFixture() {
  const modes = Object.fromEntries(
    MODES.map((mode: Mode) => {
      const cfg = MODE_CONFIGS[mode]
      return [
        mode,
        {
          teamSize: cfg.teamSize,
          winCondition: cfg.winCondition,
          launches: cfg.maps.map((map) => ({ map, cs2: resolveLaunch(mode, map) })),
        },
      ]
    }),
  )
  return { generatedBy: "pnpm -C packages/shared export:modes", execCfgs: agentExecCfgs(), modes }
}

export function launchFixtureJson(): string {
  return JSON.stringify(launchFixture(), null, 2) + "\n"
}
