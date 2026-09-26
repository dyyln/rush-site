import { DEMO_RECORDING_FLAG, DemoRecordingWriteSchema, type DemoRecordingView, type FeatureFlag } from "@rushsite/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { AdminError } from "./routes.js"
import type { AdminStore } from "./store.js"
import type { AdminPluginOptions } from "./types.js"

export interface DemoRecordingDeps {
  store: AdminStore
  opts: Pick<AdminPluginOptions, "flags" | "demoStorageConfigured" | "emitAdmin">
}

// The setting lives in feature_flags. A missing row means off
function view(flag: FeatureFlag | null, s3Configured: boolean): DemoRecordingView {
  return {
    enabled: flag?.enabled ?? false,
    s3Configured,
    updatedBy: flag?.updatedBy ?? null,
    updatedAt: flag?.updatedAt ?? null,
  }
}

export function registerDemoRecordingRoutes(app: FastifyInstance, deps: DemoRecordingDeps, adminOf: (req: FastifyRequest) => string) {
  const { store, opts } = deps
  const flags = () => {
    if (!opts.flags) throw new AdminError(404, "not_found", "Settings are not available")
    return opts.flags
  }
  const s3 = () => opts.demoStorageConfigured ?? false

  app.get("/admin/demo-recording", async () => view(await flags().get(DEMO_RECORDING_FLAG), s3()))

  // Applies to servers allocated from now on. Running matches keep what they started with
  app.put("/admin/demo-recording", async (req) => {
    const r = DemoRecordingWriteSchema.safeParse(req.body)
    if (!r.success) throw new AdminError(400, "invalid_request", "enabled must be true or false")
    const { flag, before } = await flags().set(DEMO_RECORDING_FLAG, r.data.enabled, undefined, adminOf(req))
    const entry = await store.writeAudit({
      adminSteamId: adminOf(req),
      action: "demo_recording.set",
      target: DEMO_RECORDING_FLAG,
      payload: { enabled: flag.enabled, before: before?.enabled ?? false, s3Configured: s3() },
    })
    opts.emitAdmin("host", { action: "demo_recording_set", enabled: flag.enabled, by: entry.adminSteamId })
    return { setting: view(flag, s3()), audit: entry }
  })
}
