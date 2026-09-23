// Tables for the challenges module. Re-exported from src/db/schema.ts so migrations include them
import type { ChallengeStatus, Mode } from "@rushsite/shared"
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" })

export const challenges = pgTable(
  "challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mode: text("mode").$type<Mode>().notNull(),
    createdBy: text("created_by").notNull(),
    // null is an open link. Set to the accepter once accepted
    targetSteamId: text("target_steam_id"),
    rematchOfMatchId: uuid("rematch_of_match_id"),
    code: text("code").notNull().unique(),
    status: text("status").$type<ChallengeStatus>().notNull().default("open"),
    expiresAt: ts("expires_at").notNull(),
    matchId: uuid("match_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("challenges_status_expires_idx").on(t.status, t.expiresAt),
    index("challenges_created_by_idx").on(t.createdBy, t.status),
    index("challenges_target_idx").on(t.targetSteamId, t.status),
    index("challenges_rematch_idx").on(t.rematchOfMatchId),
  ],
)
