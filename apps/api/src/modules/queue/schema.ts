// Tables for the queue module. Re-exported from src/db/schema.ts so migrations include them
import type { TrustLevel } from "@rushsite/shared"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const userSettings = pgTable("user_settings", {
  steamId: text("steam_id").primaryKey(),
  // Lowest trust level an opponent may have
  minTrust: text("min_trust").$type<TrustLevel>().notNull().default("new"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
})
