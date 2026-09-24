import { asc, eq } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Db } from "../db/client.js"
import { admins } from "../db/schema.js"

export type AdminRow = { steamId: string; addedBy: string; note: string | null; createdAt: Date }

const TTL_MS = 30_000
// Gap between background reloads after a failed one
const RETRY_MS = 5_000

// Admin list. ADMIN_STEAM_IDS are root admins and the admins table adds more.
// The table is cached in memory so sync checks such as the WS gate never hit the db.
// Writes on this instance update the cache at once. Other instances catch up within the TTL.
export class AdminRegistry {
  private readonly roots: ReadonlySet<string>
  private ids = new Set<string>()
  private loadedAt = -Infinity
  private triedAt = -Infinity
  private loading: Promise<void> | null = null
  // Bumped on every local write so a reload that started earlier cannot undo it
  private version = 0

  constructor(
    private readonly db: Db,
    rootIds: readonly string[],
    private readonly log?: FastifyBaseLogger,
    private readonly clock: () => number = Date.now,
    private readonly ttlMs = TTL_MS,
  ) {
    this.roots = new Set(rootIds)
  }

  rootIds(): string[] {
    return [...this.roots]
  }

  isRoot(steamId: string): boolean {
    return this.roots.has(steamId)
  }

  // Answers from the cache. A stale cache answers now and reloads in the background
  isAdmin(steamId: string): boolean {
    if (this.roots.has(steamId)) return true
    const t = this.clock()
    if (this.stale() && t - this.triedAt >= RETRY_MS) void this.refresh().catch(() => undefined)
    return this.ids.has(steamId)
  }

  // Waits for a reload when the cache is stale
  async ensureFresh(): Promise<void> {
    if (this.stale()) await this.refresh().catch(() => undefined)
  }

  refresh(): Promise<void> {
    this.loading ??= this.load().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  async list(): Promise<AdminRow[]> {
    return this.db.select().from(admins).orderBy(asc(admins.createdAt))
  }

  // Null when the id already has a row
  async grant(steamId: string, addedBy: string, note: string | null): Promise<AdminRow | null> {
    const [row] = await this.db
      .insert(admins)
      .values({ steamId, addedBy, note })
      .onConflictDoNothing({ target: admins.steamId })
      .returning()
    this.version++
    this.ids.add(steamId)
    return row ?? null
  }

  async revoke(steamId: string): Promise<AdminRow | null> {
    const [row] = await this.db.delete(admins).where(eq(admins.steamId, steamId)).returning()
    this.version++
    this.ids.delete(steamId)
    return row ?? null
  }

  private stale(): boolean {
    return this.clock() - this.loadedAt >= this.ttlMs
  }

  private async load(): Promise<void> {
    const started = this.version
    this.triedAt = this.clock()
    try {
      const rows = await this.db.select({ steamId: admins.steamId }).from(admins)
      if (this.version !== started) return
      this.ids = new Set(rows.map((r) => r.steamId))
      this.loadedAt = this.clock()
    } catch (err) {
      this.log?.warn({ err }, "admin list reload failed")
      throw err
    }
  }
}
