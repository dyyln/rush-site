import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const shared = fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
const faceit = fileURLToPath(new URL("../../packages/faceit/src/index.ts", import.meta.url))
const dathost = fileURLToPath(new URL("../../packages/dathost/src/index.ts", import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@rushsite\/shared$/, replacement: shared },
      { find: /^@rushsite\/faceit$/, replacement: faceit },
      { find: /^@rushsite\/dathost$/, replacement: dathost },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 120000,
  },
})
