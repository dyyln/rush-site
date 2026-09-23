// Writes agent/testdata/modes.json from the built shared config
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { launchFixtureJson, MODES_FIXTURE_PATH } from "../dist/index.js"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const out = resolve(repo, MODES_FIXTURE_PATH)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, launchFixtureJson())
console.log(`wrote ${out}`)
