// Live aim map pool. Re-exported from src/db/schema.ts so migrations include them.
import type { MapLoadout, PoolMode, WorkshopItem } from "@rushsite/shared"
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

// Empty until an admin first edits the pool. The shared config is used until then
export const mapPool = pgTable(
  "map_pool",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    workshopId: text("workshop_id"),
    mapName: text("map_name"),
    loadout: jsonb("loadout").$type<MapLoadout>(),
    // Modes the map is enabled in
    modes: jsonb("modes").$type<PoolMode[]>().notNull().default([]),
    position: integer("position").notNull(),
    // Steam CDN preview for admin added maps
    previewUrl: text("preview_url"),
    // config or admin
    source: text("source").notNull(),
    workshop: jsonb("workshop").$type<WorkshopItem>(),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("map_pool_position_idx").on(t.position)],
)
