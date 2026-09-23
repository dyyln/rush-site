import { z } from "zod"
import { SteamId64Schema } from "./common.js"

// Up to 5 entries shown as an avatar stack on cup list rows. One per entry with the captain avatar and entry name
export const CUP_ENTRANT_PREVIEW_MAX = 5
export const CupEntrantPreviewSchema = z.object({
  steamId: SteamId64Schema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
})
export type CupEntrantPreview = z.infer<typeof CupEntrantPreviewSchema>

// Champion of a completed cup. The team name for team cups, avatar of the captain
export const CupWinnerSchema = z.object({
  entryId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
})
export type CupWinner = z.infer<typeof CupWinnerSchema>
