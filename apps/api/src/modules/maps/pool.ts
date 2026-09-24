import {
  MODE_CONFIGS,
  MODES,
  POOL_MODES,
  RUSH_MAP,
  configPool,
  findMap,
  isPoolMode,
  isRushMode,
  minPoolSize,
  poolMapEntry,
  type MapEntry,
  type MapLoadout,
  type Mode,
  type PoolMap,
  type PoolMode,
  type PoolView,
  type PublicMap,
  type WorkshopItem,
} from "@rushsite/shared"
import { asc, eq, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Db } from "../../db/client.js"
import { mapPool } from "./schema.js"

type Row = typeof mapPool.$inferSelect

const TTL_MS = 30_000
const sqlLock = sql`select pg_advisory_xact_lock(hashtext('map_pool'))`
const RETRY_MS = 5_000

export class PoolError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export type PoolAdd = {
  id: string
  displayName: string
  mapName?: string
  modes: PoolMode[]
  loadout?: MapLoadout
  workshop: WorkshopItem
}

export type PoolPatch = { displayName?: string; modes?: PoolMode[]; loadout?: MapLoadout | null }

// Read side for the matchmaker and the site
export interface MapPoolReader {
  // Enabled maps of a mode in pool order
  entries(mode: Mode): MapEntry[]
  // Any known map of the mode, enabled or not, so running matches keep their map
  find(mode: Mode, mapId: string): MapEntry | undefined
}

// Reads straight from the shared config. Used when no pool service is wired in
export const configMaps: MapPoolReader = {
  entries: (mode) => [...MODE_CONFIGS[mode].maps],
  find: (mode, mapId) => findMap(mode, mapId),
}

function toView(r: Row): PoolMap {
  return {
    id: r.id,
    displayName: r.displayName,
    workshopId: r.workshopId,
    mapName: r.mapName,
    loadout: r.loadout ?? null,
    modes: POOL_MODES.filter((m) => (r.modes ?? []).includes(m)),
    position: r.position,
    previewUrl: r.previewUrl,
    source: r.source === "admin" ? "admin" : "config",
    workshop: r.workshop ?? null,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt.toISOString(),
  }
}

// Refuses a change that shrinks a mode below what its veto needs
export function checkMinPool(before: PoolMap[], after: PoolMap[]): void {
  for (const mode of POOL_MODES) {
    const was = before.filter((m) => m.modes.includes(mode)).length
    const now = after.filter((m) => m.modes.includes(mode)).length
    const min = minPoolSize(mode)
    if (now < min && now < was) {
      throw new PoolError(409, "pool_too_small", `${mode} needs at least ${min} enabled maps for the veto`, { mode, min, enabled: now })
    }
  }
}

// The live aim map pool. Rows are cached in memory so match code reads it without a query.
// Writes on this instance reload at once. Other instances catch up within the TTL.
export class MapPoolService implements MapPoolReader {
  private rows: PoolMap[] = []
  private loadedAt = -Infinity
  private triedAt = -Infinity
  private loading: Promise<void> | null = null

  constructor(
    private readonly db: Db,
    private readonly log?: FastifyBaseLogger,
    private readonly clock: () => number = Date.now,
    private readonly ttlMs = TTL_MS,
  ) {}

  refresh(): Promise<void> {
    this.loading ??= this.load().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  async ensureFresh(): Promise<void> {
    if (this.clock() - this.loadedAt >= this.ttlMs) await this.refresh().catch(() => undefined)
  }

  private async load(): Promise<void> {
    this.triedAt = this.clock()
    try {
      const rows = await this.db.select().from(mapPool).orderBy(asc(mapPool.position), asc(mapPool.id))
      this.rows = rows.map(toView)
      this.loadedAt = this.clock()
    } catch (err) {
      this.log?.warn({ err }, "map pool reload failed")
      throw err
    }
  }

  // Stale reads answer now and reload in the background
  private snapshot(): PoolMap[] {
    const t = this.clock()
    if (t - this.loadedAt >= this.ttlMs && t - this.triedAt >= RETRY_MS) void this.refresh().catch(() => undefined)
    return this.rows.length > 0 ? this.rows : configPool()
  }

  stored(): boolean {
    return this.rows.length > 0
  }

  entries(mode: Mode): MapEntry[] {
    if (!isPoolMode(mode)) return [...MODE_CONFIGS[mode].maps]
    return this.snapshot()
      .filter((m) => m.modes.includes(mode))
      .map(poolMapEntry)
  }

  find(mode: Mode, mapId: string): MapEntry | undefined {
    if (!isPoolMode(mode)) return findMap(mode, mapId)
    const row = this.snapshot().find((m) => m.id === mapId)
    return row ? poolMapEntry(row) : findMap(mode, mapId)
  }

  async view(): Promise<PoolView> {
    await this.ensureFresh()
    const maps = this.snapshot()
    return {
      maps,
      stored: this.stored(),
      minPool: Object.fromEntries(POOL_MODES.map((m) => [m, minPoolSize(m)])) as Record<PoolMode, number>,
    }
  }

  // Every map the site may need to name, including disabled and config maps
  async publicMaps(): Promise<PublicMap[]> {
    await this.ensureFresh()
    const pool = this.snapshot()
    const out: PublicMap[] = pool.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      modes: m.modes,
      previewUrl: m.previewUrl,
      workshopId: m.workshopId,
    }))
    for (const m of configPool()) {
      if (!out.some((x) => x.id === m.id)) out.push({ id: m.id, displayName: m.displayName, modes: [], previewUrl: null, workshopId: m.workshopId })
    }
    out.push({ id: RUSH_MAP.id, displayName: RUSH_MAP.displayName, modes: MODES.filter(isRushMode), previewUrl: null, workshopId: null })
    return out
  }

  // Writes. Each runs in a transaction and seeds the config pool first when the table is empty
  private async write<T>(by: string, fn: (tx: Db, current: PoolMap[]) => Promise<T>): Promise<T> {
    const result = await this.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db
      // Serialises pool writes so two admins cannot both pass the min pool check
      await tx.execute(sqlLock)
      let rows = await tx.select().from(mapPool).orderBy(asc(mapPool.position), asc(mapPool.id))
      if (rows.length === 0) {
        const seed = configPool()
        await tx.insert(mapPool).values(
          seed.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            workshopId: m.workshopId,
            mapName: m.mapName,
            loadout: m.loadout,
            modes: m.modes,
            position: m.position,
            previewUrl: null,
            source: "config",
            createdBy: by,
            updatedBy: by,
          })),
        )
        rows = await tx.select().from(mapPool).orderBy(asc(mapPool.position), asc(mapPool.id))
      }
      return fn(tx, rows.map(toView))
    })
    await this.refresh().catch(() => undefined)
    return result
  }

  async add(input: PoolAdd, by: string): Promise<PoolMap> {
    return this.write(by, async (tx, current) => {
      if (current.some((m) => m.id === input.id)) throw new PoolError(409, "map_exists", `A map with id ${input.id} is already in the pool`)
      const dup = current.find((m) => m.workshopId === input.workshop.workshopId)
      if (dup) throw new PoolError(409, "map_exists", `That Workshop item is already in the pool as ${dup.id}`)
      const position = current.reduce((max, m) => Math.max(max, m.position), -1) + 1
      const [row] = await tx
        .insert(mapPool)
        .values({
          id: input.id,
          displayName: input.displayName,
          workshopId: input.workshop.workshopId,
          mapName: input.mapName ?? null,
          loadout: input.loadout ?? null,
          modes: POOL_MODES.filter((m) => input.modes.includes(m)),
          position,
          previewUrl: input.workshop.previewUrl,
          source: "admin",
          workshop: input.workshop,
          createdBy: by,
          updatedBy: by,
        })
        .returning()
      return toView(row!)
    })
  }

  async update(id: string, patch: PoolPatch, by: string): Promise<{ before: PoolMap; after: PoolMap }> {
    return this.write(by, async (tx, current) => {
      const before = current.find((m) => m.id === id)
      if (!before) throw new PoolError(404, "not_found", "Map not found")
      const modes = patch.modes ? POOL_MODES.filter((m) => patch.modes!.includes(m)) : before.modes
      checkMinPool(
        current,
        current.map((m) => (m.id === id ? { ...m, modes } : m)),
      )
      const [row] = await tx
        .update(mapPool)
        .set({
          ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
          ...(patch.modes !== undefined ? { modes } : {}),
          ...(patch.loadout !== undefined ? { loadout: patch.loadout } : {}),
          updatedBy: by,
          updatedAt: new Date(this.clock()),
        })
        .where(eq(mapPool.id, id))
        .returning()
      return { before, after: toView(row!) }
    })
  }

  async reorder(ids: string[], by: string): Promise<PoolMap[]> {
    return this.write(by, async (tx, current) => {
      const known = new Set(current.map((m) => m.id))
      if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
        throw new PoolError(400, "invalid_request", "ids must list every pool map once")
      }
      const at = new Date(this.clock())
      for (const [position, id] of ids.entries()) {
        await tx.update(mapPool).set({ position, updatedBy: by, updatedAt: at }).where(eq(mapPool.id, id))
      }
      const rows = await tx.select().from(mapPool).orderBy(asc(mapPool.position))
      return rows.map(toView)
    })
  }

  // Only admin added maps that are off in every mode
  async remove(id: string, by: string): Promise<PoolMap> {
    return this.write(by, async (tx, current) => {
      const row = current.find((m) => m.id === id)
      if (!row) throw new PoolError(404, "not_found", "Map not found")
      if (row.source !== "admin") throw new PoolError(409, "config_map", "Maps from the shared config can be disabled but not removed")
      if (row.modes.length > 0) throw new PoolError(409, "map_enabled", "Disable the map in every mode first")
      await tx.delete(mapPool).where(eq(mapPool.id, id))
      return row
    })
  }
}
