// Tables for player activity. Re-export from src/db/schema.ts so migrations include them.
import { bigserial, doublePrecision, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" })

// One row per thing a player did. Rows are never updated or deleted.
export const activityEvents = pgTable(
  "activity_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    steamId: text("steam_id").notNull(),
    // See ACTIVITY_KINDS in service.ts
    kind: text("kind").notNull(),
    mode: text("mode"),
    // Match, ticket or cup id, or the id in a page path
    ref: text("ref"),
    // Page route, leave reason, match source or outcome
    detail: text("detail"),
    // Seconds waited for queue events, seconds played for match_end
    value: doublePrecision("value"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("activity_events_user_idx").on(t.steamId, t.at), index("activity_events_kind_idx").on(t.kind, t.at)],
)

// Running totals per player, updated with every event
export const userActivity = pgTable("user_activity", {
  steamId: text("steam_id").primaryKey(),
  sessions: integer("sessions").notNull().default(0),
  pageViews: integer("page_views").notNull().default(0),
  queueJoins: integer("queue_joins").notNull().default(0),
  queueSeconds: doublePrecision("queue_seconds").notNull().default(0),
  matchesFound: integer("matches_found").notNull().default(0),
  matchesAccepted: integer("matches_accepted").notNull().default(0),
  matchesDeclined: integer("matches_declined").notNull().default(0),
  matchesMissed: integer("matches_missed").notNull().default(0),
  matchesPlayed: integer("matches_played").notNull().default(0),
  matchesWon: integer("matches_won").notNull().default(0),
  cupSignups: integer("cup_signups").notNull().default(0),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  // The last event that was not a session start
  lastAction: text("last_action"),
  lastActionDetail: text("last_action_detail"),
  lastActionMode: text("last_action_mode"),
  lastActionAt: ts("last_action_at"),
  lastPage: text("last_page"),
})
