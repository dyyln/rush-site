// Tables for the admin module. Re-export from src/db/schema.ts so migrations include them.
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

// One row per admin action. Rows are never updated or deleted.
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminSteamId: text("admin_steam_id").notNull(),
    // queue.remove, match.cancel, user.ban, user.unban, user.trust
    action: text("action").notNull(),
    // Ticket id, match id or SteamID64
    target: text("target").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_target_idx").on(t.target, t.createdAt),
    index("admin_audit_created_idx").on(t.createdAt),
  ],
)
