import { z } from "zod"
import { TrustLevelSchema } from "./trust.js"

// Per user preferences. GET /me returns them as settings
export const UserSettingsSchema = z.object({
  // Lowest trust level an opponent may have. Applied to queue joins that omit it
  minTrust: TrustLevelSchema,
})
export type UserSettings = z.infer<typeof UserSettingsSchema>

// Body of PATCH /me/settings
export const UserSettingsPatchSchema = UserSettingsSchema.partial()
export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>

export const DEFAULT_USER_SETTINGS: UserSettings = { minTrust: "new" }
