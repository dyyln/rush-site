import { z } from "zod"

export const SteamId64Schema = z.string().regex(/^\d{17}$/, "expected a 17 digit SteamID64")
export type SteamId64 = z.infer<typeof SteamId64Schema>

export const UuidSchema = z.uuid()
export type Uuid = z.infer<typeof UuidSchema>

export const RegionSchema = z.enum(["eu"])
export type Region = z.infer<typeof RegionSchema>
export const REGIONS = RegionSchema.options
