// Tables for feature flags and announcements. Re-exported from src/db/schema.ts so migrations include them.
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  value: jsonb("value"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    text: text("text").notNull(),
    // info or warn
    level: text("level").notNull().default("info"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    // Null runs until removed
    endsAt: timestamp("ends_at", { withTimezone: true }),
    dismissible: boolean("dismissible").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("announcements_window_idx").on(t.startsAt, t.endsAt)],
)
