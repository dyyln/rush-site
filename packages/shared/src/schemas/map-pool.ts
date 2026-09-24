import { z } from "zod"
import { MAP_NAME_RE, MapLoadoutSchema, WORKSHOP_ID_RE } from "./mode.js"

// Modes whose pool admins can edit. Rush plays one fixed map
export const PoolModeSchema = z.enum(["aim1v1", "aim2v2"])
export type PoolMode = z.infer<typeof PoolModeSchema>
export const POOL_MODES = PoolModeSchema.options

// Map ids end up in demo names and plugin lookups, so keep them plain
export const POOL_MAP_ID_RE = /^[a-z0-9_]{2,48}$/
export const PoolMapIdSchema = z.string().regex(POOL_MAP_ID_RE, "lowercase letters, digits and underscores, 2 to 48 long")

// What Steam says about one Workshop item
export const WorkshopItemSchema = z.object({
  workshopId: z.string().regex(WORKSHOP_ID_RE),
  title: z.string(),
  url: z.string(),
  // Only Steam CDN URLs are kept. Null when the item has none
  previewUrl: z.string().nullable(),
  creatorSteamId: z.string().nullable(),
  creatorName: z.string().nullable(),
  fileSize: z.number().int().nonnegative().nullable(),
  tags: z.array(z.string()),
  // ISO 8601
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  subscriptions: z.number().int().nonnegative().nullable(),
  // True when Steam tags it as a CS2 upload
  cs2: z.boolean(),
})
export type WorkshopItem = z.infer<typeof WorkshopItemSchema>

// One map in the live pool
export const PoolMapSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  workshopId: z.string().nullable(),
  mapName: z.string().nullable(),
  loadout: MapLoadoutSchema.nullable(),
  // Modes the map is enabled in
  modes: z.array(PoolModeSchema),
  position: z.number().int(),
  // Hotlinked Steam preview for admin added maps. Config maps ship a file under /maps
  previewUrl: z.string().nullable(),
  source: z.enum(["config", "admin"]),
  workshop: WorkshopItemSchema.nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
export type PoolMap = z.infer<typeof PoolMapSchema>

// GET /admin/maps
export const PoolViewSchema = z.object({
  maps: z.array(PoolMapSchema),
  // Pool rows exist in the database. False means the shared config is in use
  stored: z.boolean(),
  minPool: z.record(PoolModeSchema, z.number().int()),
})
export type PoolView = z.infer<typeof PoolViewSchema>

// GET /maps. Every known map, for names and preview images on the site
export const PublicMapSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  modes: z.array(z.string()),
  previewUrl: z.string().nullable(),
  workshopId: z.string().nullable(),
})
export type PublicMap = z.infer<typeof PublicMapSchema>

const DisplayNameSchema = z.string().trim().min(1).max(40)

// A Workshop URL or a bare id
export const WorkshopRefSchema = z.string().trim().min(1).max(300)

// POST /admin/maps
export const PoolMapCreateSchema = z.object({
  workshop: WorkshopRefSchema,
  // Defaults to a slug of the Workshop title
  id: PoolMapIdSchema.optional(),
  displayName: DisplayNameSchema.optional(),
  // bsp name for the plugin loadout fallback. Optional
  mapName: z.string().regex(MAP_NAME_RE).optional(),
  modes: z.array(PoolModeSchema).max(2).default([]),
  loadout: MapLoadoutSchema.optional(),
})
export type PoolMapCreate = z.infer<typeof PoolMapCreateSchema>

// PATCH /admin/maps/:id. A null loadout clears it
export const PoolMapPatchSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    modes: z.array(PoolModeSchema).max(2).optional(),
    loadout: MapLoadoutSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "nothing to change")
export type PoolMapPatch = z.infer<typeof PoolMapPatchSchema>

// PUT /admin/maps/order. Every map id in the new order
export const PoolOrderSchema = z.object({ ids: z.array(PoolMapIdSchema).min(1).max(200) })
export type PoolOrder = z.infer<typeof PoolOrderSchema>
