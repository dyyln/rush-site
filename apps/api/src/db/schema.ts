import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

// Tournament tables are owned by the tournaments module and re-exported here so migrations include them
export { adminAudit } from "../modules/admin/schema.js"
export { badges, bracketMatches, brackets, tournamentEntries, tournaments } from "../modules/tournaments/schema.js"

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" })
const createdAt = () => ts("created_at").notNull().defaultNow()
const id = () => uuid("id").primaryKey().defaultRandom()
const steamId = (name = "steam_id") => text(name)

export const modeEnum = pgEnum("mode", ["aim1v1", "aim2v2", "rush3v3"])
export const trustLevelEnum = pgEnum("trust_level", ["new", "verified", "trusted"])
export const ticketStatusEnum = pgEnum("ticket_status", ["waiting", "matched", "cancelled"])
export const matchStatusEnum = pgEnum("match_status", [
  "accepting",
  "veto",
  "allocating",
  "starting",
  "ready",
  "live",
  "finished",
  "abandoned",
  "cancelled",
])
export const matchSourceEnum = pgEnum("match_source", ["queue", "tournament"])
export const hostStatusEnum = pgEnum("host_status", ["online", "offline", "updating", "draining"])
export const slotStatusEnum = pgEnum("slot_status", ["free", "reserved", "running"])
export const gsltStatusEnum = pgEnum("gslt_status", ["free", "in_use", "invalid"])
export const cooldownReasonEnum = pgEnum("cooldown_reason", ["decline", "accept_timeout", "no_connect", "abandon"])
export const ratingEventReasonEnum = pgEnum("rating_event_reason", ["match", "forfeit", "rollback", "adjust"])
export const flagStatusEnum = pgEnum("flag_status", ["open", "confirmed", "dismissed"])
export const verdictEnum = pgEnum("review_verdict", ["cheat", "clean"])
export const reportStatusEnum = pgEnum("report_status", ["open", "actioned", "dismissed"])

// Identity is the SteamID64
export const users = pgTable("users", {
  steamId: steamId().primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  profileUrl: text("profile_url"),
  countryCode: text("country_code"),
  region: text("region").notNull().default("eu"),
  createdAt: createdAt(),
  lastLoginAt: ts("last_login_at").notNull().defaultNow(),
})

// Last Steam Web API snapshot for a user
export const steamProfiles = pgTable("steam_profiles", {
  steamId: steamId()
    .primaryKey()
    .references(() => users.steamId, { onDelete: "cascade" }),
  personaName: text("persona_name").notNull(),
  avatarFull: text("avatar_full"),
  communityVisibility: integer("community_visibility"),
  // Steam account creation time. Only visible on public profiles
  accountCreatedAt: ts("account_created_at"),
  cs2PlaytimeMinutes: integer("cs2_playtime_minutes"),
  raw: jsonb("raw"),
  fetchedAt: ts("fetched_at").notNull().defaultNow(),
})

// One row per check and source. data holds the raw answer for audit
export const trustSignals = pgTable(
  "trust_signals",
  {
    id: id(),
    steamId: steamId()
      .notNull()
      .references(() => users.steamId, { onDelete: "cascade" }),
    source: text("source").notNull(),
    clean: boolean("clean").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [index("trust_signals_user_source_idx").on(t.steamId, t.source, t.fetchedAt)],
)

export const trustLevels = pgTable("trust_levels", {
  steamId: steamId()
    .primaryKey()
    .references(() => users.steamId, { onDelete: "cascade" }),
  level: trustLevelEnum("level").notNull().default("new"),
  reason: text("reason").notNull().default(""),
  // Set by an admin. Automatic evaluation leaves it alone
  locked: boolean("locked").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
})

export const parties = pgTable("parties", {
  id: id(),
  leaderSteamId: steamId("leader_steam_id")
    .notNull()
    .references(() => users.steamId),
  inviteToken: text("invite_token").notNull().unique(),
  createdAt: createdAt(),
  disbandedAt: ts("disbanded_at"),
})

// A user is in at most one party
export const partyMembers = pgTable(
  "party_members",
  {
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    steamId: steamId()
      .notNull()
      .references(() => users.steamId),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.partyId, t.steamId] }), uniqueIndex("party_members_user_uq").on(t.steamId)],
)

// One ticket per party. It waits in every listed mode until a match in one of them consumes it
export const queueTickets = pgTable(
  "queue_tickets",
  {
    id: id(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    modes: modeEnum("modes").array().notNull(),
    region: text("region").notNull().default("eu"),
    steamIds: text("steam_ids").array().notNull(),
    // Party mean rating per queued mode
    ratings: jsonb("ratings").$type<Partial<Record<"aim1v1" | "aim2v2" | "rush3v3", number>>>().notNull(),
    status: ticketStatusEnum("status").notNull().default("waiting"),
    matchId: uuid("match_id"),
    matchedMode: modeEnum("matched_mode"),
    cancelReason: text("cancel_reason"),
    enqueuedAt: ts("enqueued_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("queue_tickets_status_idx").on(t.status), index("queue_tickets_party_idx").on(t.partyId)],
)

export type TeamRosterJson = { name: string; steamIds: string[] }

export const matches = pgTable(
  "matches",
  {
    id: id(),
    mode: modeEnum("mode").notNull(),
    region: text("region").notNull().default("eu"),
    source: matchSourceEnum("source").notNull().default("queue"),
    status: matchStatusEnum("status").notNull(),
    teams: jsonb("teams").$type<TeamRosterJson[]>().notNull(),
    // Played map ids in order after the veto
    maps: jsonb("maps").$type<string[]>(),
    mapId: text("map_id"),
    winnerTeam: text("winner_team"),
    score: jsonb("score").$type<Record<string, number>>(),
    acceptDeadline: ts("accept_deadline"),
    // Tournament link. The tournaments module owns the meaning
    tournamentId: uuid("tournament_id"),
    bracketMatchKey: text("bracket_match_key"),
    gameNumber: integer("game_number"),
    bestOf: integer("best_of"),
    // Server allocation. driver is hetzner or dathost, driverRef is the host id or the DatHost server id
    driver: text("driver"),
    driverRef: text("driver_ref"),
    hostId: uuid("host_id"),
    slotId: uuid("slot_id"),
    gsltId: uuid("gslt_id"),
    serverIp: text("server_ip"),
    serverPort: integer("server_port"),
    connect: text("connect"),
    password: text("password"),
    webhookSecret: text("webhook_secret").notNull(),
    allocationStartedAt: ts("allocation_started_at"),
    readyAt: ts("ready_at"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    // Set once the server is stopped and the slot and GSLT are free again
    serverReleasedAt: ts("server_released_at"),
    cancelReason: text("cancel_reason"),
    ratingApplied: boolean("rating_applied").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("matches_status_idx").on(t.status), index("matches_created_idx").on(t.createdAt)],
)

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    steamId: steamId()
      .notNull()
      .references(() => users.steamId),
    team: integer("team").notNull(),
    partyId: uuid("party_id"),
    ticketId: uuid("ticket_id"),
    accepted: boolean("accepted").notNull().default(false),
    declined: boolean("declined").notNull().default(false),
    connected: boolean("connected").notNull().default(false),
    everConnected: boolean("ever_connected").notNull().default(false),
    abandoned: boolean("abandoned").notNull().default(false),
    won: boolean("won"),
    kills: integer("kills"),
    deaths: integer("deaths"),
    headshots: integer("headshots"),
    damage: doublePrecision("damage"),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.steamId] }), index("match_players_user_idx").on(t.steamId)],
)

export const matchRounds = pgTable(
  "match_rounds",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    winnerTeam: text("winner_team").notNull(),
    score: jsonb("score").$type<Record<string, number>>().notNull(),
    // Rush arena the round was played on
    arena: text("arena"),
    endedAt: ts("ended_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.round] })],
)

// Veto state is the shared VetoState JSON
export const vetoes = pgTable("vetoes", {
  matchId: uuid("match_id")
    .primaryKey()
    .references(() => matches.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  state: jsonb("state").notNull(),
  stepDeadline: ts("step_deadline"),
  done: boolean("done").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
})

export const ratings = pgTable(
  "ratings",
  {
    steamId: steamId()
      .notNull()
      .references(() => users.steamId),
    mode: modeEnum("mode").notNull(),
    rating: doublePrecision("rating").notNull(),
    rd: doublePrecision("rd").notNull(),
    volatility: doublePrecision("volatility").notNull(),
    matchesPlayed: integer("matches_played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.steamId, t.mode] }), index("ratings_mode_rating_idx").on(t.mode, t.rating)],
)

// Before and after per player per match. Opponent composite and score are kept so a rollback can replay
export const ratingEvents = pgTable(
  "rating_events",
  {
    id: id(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    matchId: uuid("match_id"),
    steamId: steamId()
      .notNull()
      .references(() => users.steamId),
    mode: modeEnum("mode").notNull(),
    reason: ratingEventReasonEnum("reason").notNull(),
    ratingBefore: doublePrecision("rating_before").notNull(),
    rdBefore: doublePrecision("rd_before").notNull(),
    volBefore: doublePrecision("vol_before").notNull(),
    ratingAfter: doublePrecision("rating_after").notNull(),
    rdAfter: doublePrecision("rd_after").notNull(),
    volAfter: doublePrecision("vol_after").notNull(),
    oppRating: doublePrecision("opp_rating"),
    oppRd: doublePrecision("opp_rd"),
    // 1 win, 0.5 draw, 0 loss
    score: doublePrecision("score"),
    voidedAt: ts("voided_at"),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("rating_events_user_mode_idx").on(t.steamId, t.mode, t.seq),
    index("rating_events_match_idx").on(t.matchId),
  ],
)

export const hosts = pgTable("hosts", {
  id: id(),
  name: text("name").notNull(),
  agentUrl: text("agent_url").notNull().unique(),
  publicIp: text("public_ip"),
  status: hostStatusEnum("status").notNull().default("offline"),
  cs2Version: text("cs2_version"),
  totalSlots: integer("total_slots").notNull().default(0),
  freeSlots: integer("free_slots").notNull().default(0),
  lastSeenAt: ts("last_seen_at"),
  createdAt: createdAt(),
})

export const serverSlots = pgTable(
  "server_slots",
  {
    id: id(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(),
    status: slotStatusEnum("status").notNull().default("free"),
    matchId: uuid("match_id"),
    port: integer("port"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("server_slots_host_idx").on(t.hostId, t.slotIndex)],
)

export const gsltTokens = pgTable("gslt_tokens", {
  id: id(),
  token: text("token").notNull().unique(),
  status: gsltStatusEnum("status").notNull().default("free"),
  matchId: uuid("match_id"),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
})

export const demos = pgTable("demos", {
  id: id(),
  matchId: uuid("match_id")
    .notNull()
    .unique()
    .references(() => matches.id, { onDelete: "cascade" }),
  bucket: text("bucket").notNull(),
  key: text("key").notNull(),
  uploaded: boolean("uploaded").notNull().default(false),
  // Flagged demos are kept until review is done
  keep: boolean("keep").notNull().default(false),
  deleteAfter: ts("delete_after"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
})

export const flags = pgTable(
  "flags",
  {
    id: id(),
    steamId: steamId()
      .notNull()
      .references(() => users.steamId),
    matchId: uuid("match_id"),
    source: text("source").notNull(),
    status: flagStatusEnum("status").notNull().default("open"),
    detail: jsonb("detail"),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("flags_user_idx").on(t.steamId, t.status)],
)

// Every ruling is a labelled training example
export const reviews = pgTable("reviews", {
  id: id(),
  flagId: uuid("flag_id")
    .notNull()
    .references(() => flags.id, { onDelete: "cascade" }),
  reviewerSteamId: steamId("reviewer_steam_id")
    .notNull()
    .references(() => users.steamId),
  verdict: verdictEnum("verdict").notNull(),
  adminOverride: boolean("admin_override").notNull().default(false),
  note: text("note"),
  createdAt: createdAt(),
})

export const bans = pgTable(
  "bans",
  {
    id: id(),
    steamId: steamId()
      .notNull()
      .references(() => users.steamId),
    reason: text("reason").notNull(),
    bannedBy: text("banned_by"),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    // Start of the window whose wins were rolled back
    rollbackFrom: ts("rollback_from"),
    createdAt: createdAt(),
  },
  (t) => [index("bans_user_idx").on(t.steamId)],
)

export const reports = pgTable("reports", {
  id: id(),
  reporterSteamId: steamId("reporter_steam_id")
    .notNull()
    .references(() => users.steamId),
  reportedSteamId: steamId("reported_steam_id")
    .notNull()
    .references(() => users.steamId),
  matchId: uuid("match_id"),
  reason: text("reason").notNull(),
  detail: text("detail"),
  status: reportStatusEnum("status").notNull().default("open"),
  createdAt: createdAt(),
})

export const cooldowns = pgTable(
  "cooldowns",
  {
    id: id(),
    steamId: steamId()
      .notNull()
      .references(() => users.steamId),
    reason: cooldownReasonEnum("reason").notNull(),
    matchId: uuid("match_id"),
    // 1 based offence number within the decay window
    offence: integer("offence").notNull(),
    endsAt: ts("ends_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("cooldowns_user_idx").on(t.steamId, t.endsAt)],
)
