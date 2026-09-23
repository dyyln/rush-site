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
