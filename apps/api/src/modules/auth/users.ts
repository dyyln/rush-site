import { inArray, sql } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { steamProfiles, users } from "../../db/schema.js"
import type { SteamSummary } from "./steam.js"

export type UserCard = { steamId: string; displayName: string; avatarUrl: string | null }

export class UsersService {
  constructor(private readonly db: Db) {}

  // Creates or refreshes the user. Without a Steam API key the name falls back to the id
  async upsertFromSteam(steamId: string, summary: SteamSummary | null, cs2PlaytimeMinutes: number | null): Promise<void> {
    const displayName = summary?.personaname?.trim() || steamId
    const avatarUrl = summary?.avatarfull ?? summary?.avatarmedium ?? summary?.avatar ?? null
    await this.db
      .insert(users)
      .values({
        steamId,
        displayName,
        avatarUrl,
        profileUrl: summary?.profileurl ?? null,
        countryCode: summary?.loccountrycode ?? null,
      })
      .onConflictDoUpdate({
        target: users.steamId,
        set: summary
          ? {
              displayName,
              avatarUrl,
              profileUrl: summary.profileurl ?? null,
              countryCode: summary.loccountrycode ?? null,
              lastLoginAt: sql`now()`,
            }
          : { lastLoginAt: sql`now()` },
      })
    if (summary) {
      const row = {
        steamId,
        personaName: displayName,
        avatarFull: summary.avatarfull ?? null,
        communityVisibility: summary.communityvisibilitystate ?? null,
        accountCreatedAt: summary.timecreated ? new Date(summary.timecreated * 1000) : null,
        cs2PlaytimeMinutes,
        raw: summary,
        fetchedAt: new Date(),
      }
      await this.db.insert(steamProfiles).values(row).onConflictDoUpdate({ target: steamProfiles.steamId, set: row })
    }
  }

  async cards(steamIds: string[]): Promise<Map<string, UserCard>> {
    const out = new Map<string, UserCard>()
    if (steamIds.length === 0) return out
    const rows = await this.db
      .select({ steamId: users.steamId, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.steamId, steamIds))
    for (const r of rows) out.set(r.steamId, r)
    return out
  }

  async card(steamId: string): Promise<UserCard | null> {
    return (await this.cards([steamId])).get(steamId) ?? null
  }
}
