import { DEMO_RECORDING_FLAG, MODES, queueOpenFlag, type Announcement, type AnnouncementLevel, type FeatureFlag, type Mode } from "@rushsite/shared"
import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { announcements, featureFlags } from "./schema.js"

type FlagRow = typeof featureFlags.$inferSelect
type AnnouncementRow = typeof announcements.$inferSelect

function flagView(r: FlagRow): FeatureFlag {
  return { key: r.key, enabled: r.enabled, value: r.value ?? null, updatedBy: r.updatedBy, updatedAt: r.updatedAt.toISOString() }
}

const SERVER_FLAGS = new Set([DEMO_RECORDING_FLAG])

// Reads are served from a short in-process cache so queue joins do not hit Postgres.
// Writes on this instance clear it at once, other instances catch up within the ttl.
export class FlagService {
  private cache: { at: number; flags: Map<string, FeatureFlag> } | null = null
  private loading: Promise<Map<string, FeatureFlag>> | null = null

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 5000,
  ) {}

  private async all(): Promise<Map<string, FeatureFlag>> {
    const t = this.now()
    if (this.cache && t - this.cache.at < this.ttlMs) return this.cache.flags
    if (!this.loading) {
      this.loading = this.db
        .select()
        .from(featureFlags)
        .then((rows) => {
          const flags = new Map(rows.map((r) => [r.key, flagView(r)]))
          this.cache = { at: this.now(), flags }
          return flags
        })
        .finally(() => {
          this.loading = null
        })
    }
    return this.loading
  }

  invalidate(): void {
    this.cache = null
  }

  async list(): Promise<FeatureFlag[]> {
    return [...(await this.all()).values()].sort((a, b) => a.key.localeCompare(b.key))
  }

  async get(key: string): Promise<FeatureFlag | null> {
    return (await this.all()).get(key) ?? null
  }

  // Enabled flags only, for GET /flags. Server side settings are left out
  async publicFlags(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    for (const f of (await this.all()).values()) if (f.enabled && !SERVER_FLAGS.has(f.key)) out[f.key] = f.value ?? true
    return out
  }

  // Off unless an admin switched it on. Read on every server allocation
  async demoRecording(): Promise<boolean> {
    return (await this.get(DEMO_RECORDING_FLAG))?.enabled ?? false
  }

  async queueOpen(mode: Mode): Promise<boolean> {
    return (await this.get(queueOpenFlag(mode)))?.enabled ?? true
  }

  async closedModes(): Promise<Mode[]> {
    const flags = await this.all()
    return MODES.filter((m) => flags.get(queueOpenFlag(m))?.enabled === false)
  }

  async set(key: string, enabled: boolean, value: unknown, by: string | null): Promise<{ flag: FeatureFlag; before: FeatureFlag | null }> {
    const [prev] = await this.db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1)
    const updatedAt = new Date(this.now())
    const next = { enabled, value: value === undefined ? (prev?.value ?? null) : value, updatedBy: by, updatedAt }
    const [row] = await this.db
      .insert(featureFlags)
      .values({ key, ...next })
      .onConflictDoUpdate({ target: featureFlags.key, set: next })
      .returning()
    this.invalidate()
    return { flag: flagView(row!), before: prev ? flagView(prev) : null }
  }

  async remove(key: string): Promise<FeatureFlag | null> {
    const [row] = await this.db.delete(featureFlags).where(eq(featureFlags.key, key)).returning()
    this.invalidate()
    return row ? flagView(row) : null
  }
}

export function announcementView(r: AnnouncementRow): Announcement {
  return {
    id: r.id,
    text: r.text,
    level: r.level as AnnouncementLevel,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
    dismissible: r.dismissible,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

export type AnnouncementInput = {
  text: string
  level: AnnouncementLevel
  startsAt: Date
  endsAt: Date | null
  dismissible: boolean
}

export class AnnouncementService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  // Started and not yet ended, newest start first
  async active(): Promise<Announcement[]> {
    const at = new Date(this.now())
    const rows = await this.db
      .select()
      .from(announcements)
      .where(and(lte(announcements.startsAt, at), or(isNull(announcements.endsAt), gt(announcements.endsAt, at))))
      .orderBy(desc(announcements.startsAt))
      .limit(20)
    return rows.map(announcementView)
  }

  async list(limit = 100): Promise<Announcement[]> {
    const rows = await this.db.select().from(announcements).orderBy(desc(announcements.startsAt)).limit(limit)
    return rows.map(announcementView)
  }

  async get(id: string): Promise<Announcement | null> {
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
    return row ? announcementView(row) : null
  }

  async create(input: AnnouncementInput, by: string | null): Promise<Announcement> {
    const at = new Date(this.now())
    const [row] = await this.db
      .insert(announcements)
      .values({ ...input, createdBy: by, createdAt: at, updatedAt: at })
      .returning()
    return announcementView(row!)
  }

  async update(id: string, patch: Partial<AnnouncementInput>): Promise<Announcement | null> {
    const [row] = await this.db
      .update(announcements)
      .set({ ...patch, updatedAt: new Date(this.now()) })
      .where(eq(announcements.id, id))
      .returning()
    return row ? announcementView(row) : null
  }

  async remove(id: string): Promise<Announcement | null> {
    const [row] = await this.db.delete(announcements).where(eq(announcements.id, id)).returning()
    return row ? announcementView(row) : null
  }
}
