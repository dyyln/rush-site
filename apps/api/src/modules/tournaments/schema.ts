// Tables for the tournaments module. Move these into src/db/schema.ts when merging.
// steam_id columns should reference users once that table exists.
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import type { GameRecord } from "./bracket.js"

export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cupKey: text("cup_key").notNull(),
    name: text("name").notNull(),
    mode: text("mode").notNull(),
    cadence: text("cadence").notNull(),
    // open, running, completed, cancelled
    status: text("status").notNull().default("open"),
    maxEntrants: integer("max_entrants").notNull(),
    minTrust: text("min_trust").notNull(),
    entryFee: integer("entry_fee").notNull().default(0),
    // Snapshot of the cup format at creation. See CupFormat.
    format: jsonb("format").notNull(),
    registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    winnerEntryId: uuid("winner_entry_id"),
    // Bumped on every bracket write. Served as the bracket ETag.
    bracketVersion: integer("bracket_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tournaments_cup_start_uq").on(t.cupKey, t.startsAt),
    index("tournaments_status_start_idx").on(t.status, t.startsAt),
  ],
)

// One row per entry. An entry is a solo player or a whole team.
export const tournamentEntries = pgTable(
  "tournament_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    captainSteamId: text("captain_steam_id").notNull(),
    steamIds: text("steam_ids").array().notNull(),
    // Filled when the bracket is built.
    seed: integer("seed"),
    rating: real("rating"),
    // Chosen by the captain in 2v2 and 3v3 cups. 3 to 24 characters
    teamName: text("team_name"),
    disqualifiedAt: timestamp("disqualified_at", { withTimezone: true }),
    disqualifyReason: text("disqualify_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tournament_entries_tournament_idx").on(t.tournamentId),
    index("tournament_entries_steam_ids_idx").using("gin", t.steamIds),
  ],
)

export const brackets = pgTable("brackets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id")
    .notNull()
    .unique()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  size: integer("size").notNull(),
  rounds: integer("rounds").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const bracketMatches = pgTable(
  "bracket_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bracketId: uuid("bracket_id")
      .notNull()
      .references(() => brackets.id, { onDelete: "cascade" }),
    // Stable key such as r1m0.
    key: text("key").notNull(),
    round: integer("round").notNull(),
    index: integer("index").notNull(),
    bestOf: integer("best_of").notNull(),
    entryA: uuid("entry_a"),
    entryB: uuid("entry_b"),
    seedA: integer("seed_a"),
    seedB: integer("seed_b"),
    aResolved: boolean("a_resolved").notNull().default(false),
    bResolved: boolean("b_resolved").notNull().default(false),
    // pending, ready, live, done
    status: text("status").notNull(),
    games: jsonb("games").$type<GameRecord[]>().notNull().default([]),
    // The matches.id of the game being played now.
    liveMatchId: uuid("live_match_id"),
    // Failed provisioning attempts for the next game.
    provisionAttempts: integer("provision_attempts").notNull().default(0),
    // Set while a server is being requested. Stale claims are released.
    provisioningAt: timestamp("provisioning_at", { withTimezone: true }),
    winnerEntryId: uuid("winner_entry_id"),
    // played, bye, walkover, forfeit, double_forfeit, void
    resolution: text("resolution"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bracket_matches_key_uq").on(t.bracketId, t.key),
    index("bracket_matches_live_idx").on(t.liveMatchId),
  ],
)

export const badges = pgTable(
  "badges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    steamId: text("steam_id").notNull(),
    // cup_champion, cup_runner_up, cup_semifinalist
    kind: text("kind").notNull(),
    tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),
    mode: text("mode"),
    label: text("label").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("badges_user_tournament_uq").on(t.steamId, t.tournamentId),
    index("badges_steam_idx").on(t.steamId),
  ],
)

// Recurring cups. The scheduler creates the next tournament for every enabled row.
export const cupSchedules = pgTable(
  "cup_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stored on every tournament the schedule creates as tournaments.cup_key
    cupKey: text("cup_key").notNull(),
    name: text("name").notNull(),
    mode: text("mode").notNull(),
    // daily or weekly
    cadence: text("cadence").notNull(),
    // 0 is Sunday. Only used by weekly schedules
    weekday: integer("weekday"),
    // UTC time of day
    startTime: time("start_time").notNull(),
    maxEntrants: integer("max_entrants").notNull(),
    minTrust: text("min_trust").notNull(),
    bestOfFinal: integer("best_of_final").notNull().default(3),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cup_schedules_cup_key_uq").on(t.cupKey)],
)
