// Tables for site chat. Re-exported from src/db/schema.ts so migrations include them.
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // global, or match:<id> for a match room
    channel: text("channel").notNull(),
    steamId: text("steam_id").notNull(),
    // Masked text when the filter changed it
    body: text("body").notNull(),
    // Text as posted. Only set on masked messages and only shown to admins
    originalBody: text("original_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Set when an admin removes the message. Removed rows stay for the audit trail
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (t) => [index("chat_messages_channel_created_idx").on(t.channel, t.createdAt), index("chat_messages_user_idx").on(t.steamId)],
)

// One row per muted user. Lifting a mute deletes the row
export const chatMutes = pgTable("chat_mutes", {
  steamId: text("steam_id").primaryKey(),
  // Null is permanent
  until: timestamp("until", { withTimezone: true }),
  reason: text("reason").notNull(),
  mutedBy: text("muted_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
