// Tables for the friends module. Re-exported from src/db/schema.ts so migrations include them
import type { FriendRequestStatus, FriendSource, PartyInviteStatus } from "@rushsite/shared"
import { sql } from "drizzle-orm"
import { index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" })

// One row per pair with user_a < user_b. removed rows stop Steam auto-link from bringing a friend back
export const friendships = pgTable(
  "friendships",
  {
    userA: text("user_a").notNull(),
    userB: text("user_b").notNull(),
    status: text("status").$type<"accepted" | "removed">().notNull().default("accepted"),
    source: text("source").$type<FriendSource>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userA, t.userB] }), index("friendships_user_b_idx").on(t.userB)],
)

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromSteamId: text("from_steam_id").notNull(),
    toSteamId: text("to_steam_id").notNull(),
    status: text("status").$type<FriendRequestStatus>().notNull().default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
    respondedAt: ts("responded_at"),
  },
  (t) => [
    uniqueIndex("friend_requests_pending_pair_idx")
      .on(t.fromSteamId, t.toSteamId)
      .where(sql`${t.status} = 'pending'`),
    index("friend_requests_to_idx").on(t.toSteamId, t.status),
    index("friend_requests_from_idx").on(t.fromSteamId, t.status),
  ],
)

export const partyInvites = pgTable(
  "party_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partyId: uuid("party_id").notNull(),
    fromSteamId: text("from_steam_id").notNull(),
    toSteamId: text("to_steam_id").notNull(),
    inviteCode: text("invite_code").notNull(),
    status: text("status").$type<PartyInviteStatus>().notNull().default("pending"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    respondedAt: ts("responded_at"),
  },
  (t) => [
    index("party_invites_to_idx").on(t.toSteamId, t.status),
    index("party_invites_party_idx").on(t.partyId, t.status),
    index("party_invites_status_expires_idx").on(t.status, t.expiresAt),
  ],
)
