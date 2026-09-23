import { createDathostDriver, type DathostServerStore } from "@rushsite/dathost"
import type { ServerDriver } from "@rushsite/shared"
import { and, count, eq, isNotNull } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Db } from "../../db/client.js"
import { matches } from "../../db/schema.js"
import type { Env } from "../../env.js"

// Keeps the DatHost clone id on the match row so stop and demo fetch survive restarts
export class MatchesDathostStore implements DathostServerStore {
  constructor(private readonly db: Db) {}

  async get(matchId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ ref: matches.driverRef })
      .from(matches)
      .where(and(eq(matches.id, matchId), eq(matches.driver, "dathost")))
    return row?.ref ?? undefined
  }

  async set(matchId: string, serverId: string): Promise<void> {
    await this.db.update(matches).set({ driver: "dathost", driverRef: serverId }).where(eq(matches.id, matchId))
  }

  async delete(matchId: string): Promise<void> {
    await this.db
      .update(matches)
      .set({ driverRef: null })
      .where(and(eq(matches.id, matchId), eq(matches.driver, "dathost")))
  }

  async count(): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(matches)
      .where(and(eq(matches.driver, "dathost"), isNotNull(matches.driverRef)))
    return row?.n ?? 0
  }
}

// DatHost surge driver, or null when no account is configured
export function createSurgeDriver(env: Env, db: Db, log: FastifyBaseLogger): ServerDriver | null {
  if (!env.DATHOST_EMAIL) return null
  if (!env.DATHOST_PASSWORD || !env.DATHOST_TEMPLATE_SERVER_ID) {
    log.warn("DATHOST_EMAIL is set without DATHOST_PASSWORD or DATHOST_TEMPLATE_SERVER_ID. DatHost surge is disabled")
    return null
  }
  return createDathostDriver({
    email: env.DATHOST_EMAIL,
    password: env.DATHOST_PASSWORD,
    templateServerId: env.DATHOST_TEMPLATE_SERVER_ID,
    location: env.DATHOST_LOCATION,
    store: new MatchesDathostStore(db),
    logger: log,
  })
}
