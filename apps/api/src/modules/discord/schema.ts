// Discord links. Re-export from src/db/schema.ts so migrations include them.
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core"

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" })

// One Discord account per player and one player per Discord account
export const discordLinks = pgTable("discord_links", {
  steamId: text("steam_id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  username: text("username").notNull(),
  globalName: text("global_name"),
  avatar: text("avatar"),
  // Read from the Discord id. Useful as a signal for verification later
  discordCreatedAt: ts("discord_created_at").notNull(),
  linkedAt: ts("linked_at").notNull().defaultNow(),
  // Whether the bot last managed to give the Linked role
  roleGranted: boolean("role_granted").notNull().default(false),
  syncedAt: ts("synced_at"),
  // Last Discord error while syncing, cleared on success
  syncError: text("sync_error"),
})
