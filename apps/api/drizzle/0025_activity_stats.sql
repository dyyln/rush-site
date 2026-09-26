CREATE TABLE "activity_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"kind" text NOT NULL,
	"mode" text,
	"ref" text,
	"detail" text,
	"value" double precision,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_activity" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"queue_joins" integer DEFAULT 0 NOT NULL,
	"queue_seconds" double precision DEFAULT 0 NOT NULL,
	"matches_found" integer DEFAULT 0 NOT NULL,
	"matches_accepted" integer DEFAULT 0 NOT NULL,
	"matches_declined" integer DEFAULT 0 NOT NULL,
	"matches_missed" integer DEFAULT 0 NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"matches_won" integer DEFAULT 0 NOT NULL,
	"cup_signups" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_action" text,
	"last_action_detail" text,
	"last_action_mode" text,
	"last_action_at" timestamp with time zone,
	"last_page" text
);
--> statement-breakpoint
CREATE INDEX "activity_events_user_idx" ON "activity_events" USING btree ("steam_id","at");--> statement-breakpoint
CREATE INDEX "activity_events_kind_idx" ON "activity_events" USING btree ("kind","at");--> statement-breakpoint
-- Backfill from queue tickets, matches and cup entries. Page views and sessions start empty.
-- A requeued ticket kept only its last match, so earlier waits on it are lost.
INSERT INTO "activity_events" ("steam_id", "kind", "mode", "ref", "detail", "at")
SELECT s, 'queue_join', CASE WHEN cardinality(t."modes") = 1 THEN t."modes"[1]::text END, t."id"::text, array_to_string(t."modes"::text[], ','), t."enqueued_at"
FROM "queue_tickets" t, unnest(t."steam_ids") s;
--> statement-breakpoint
INSERT INTO "activity_events" ("steam_id", "kind", "mode", "ref", "detail", "value", "at")
SELECT s, 'queue_matched', m."mode"::text, t."id"::text, m."id"::text, greatest(0, extract(epoch FROM m."created_at" - t."enqueued_at")), m."created_at"
FROM "queue_tickets" t JOIN "matches" m ON m."id" = t."match_id", unnest(t."steam_ids") s;
--> statement-breakpoint
INSERT INTO "activity_events" ("steam_id", "kind", "mode", "ref", "detail", "value", "at")
SELECT s, 'queue_leave', CASE WHEN cardinality(t."modes") = 1 THEN t."modes"[1]::text END, t."id"::text, t."cancel_reason",
  greatest(0, extract(epoch FROM t."updated_at" - t."enqueued_at")), t."updated_at"
FROM "queue_tickets" t, unnest(t."steam_ids") s
WHERE t."status" = 'cancelled' AND t."match_id" IS NULL;
--> statement-breakpoint
INSERT INTO "activity_events" ("steam_id", "kind", "mode", "ref", "detail", "at")
SELECT mp."steam_id", 'match_found', m."mode"::text, m."id"::text, m."source"::text, m."created_at"
FROM "match_players" mp JOIN "matches" m ON m."id" = mp."match_id";
--> statement-breakpoint
INSERT INTO "activity_events" ("steam_id", "kind", "mode", "ref", "at")
SELECT mp."steam_id",
  CASE WHEN mp."accepted" THEN 'match_accept' WHEN mp."declined" THEN 'match_decline' ELSE 'match_missed' END,
  m."mode"::text, m."id"::text, m."created_at"
FROM "match_players" mp JOIN "matches" m ON m."id" = mp."match_id"
WHERE m."source" = 'queue' AND (mp."accepted" OR mp."declined" OR m."cancel_reason" = 'accept_timeout');
--> statement-breakpoint
INSERT INTO "activity_events" ("steam_id", "kind", "mode", "ref", "at")
SELECT mp."steam_id", 'match_start', m."mode"::text, m."id"::text, m."started_at"
FROM "match_players" mp JOIN "matches" m ON m."id" = mp."match_id"
WHERE m."started_at" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "activity_events" ("steam_id", "kind", "mode", "ref", "detail", "value", "at")
SELECT mp."steam_id", 'match_end', m."mode"::text, m."id"::text,
  CASE
    WHEN m."status" = 'finished' AND mp."won" THEN 'win'
    WHEN m."status" = 'finished' THEN 'loss'
    WHEN m."status" = 'abandoned' AND mp."abandoned" THEN 'forfeit'
    WHEN m."status" = 'abandoned' THEN 'abandoned'
    ELSE 'cancelled'
  END,
  CASE WHEN m."started_at" IS NOT NULL THEN greatest(0, extract(epoch FROM m."ended_at" - m."started_at")) END,
  m."ended_at"
FROM "match_players" mp JOIN "matches" m ON m."id" = mp."match_id"
WHERE m."status" IN ('finished', 'abandoned', 'cancelled') AND m."ended_at" IS NOT NULL
  AND coalesce(m."cancel_reason", '') NOT LIKE 'accept\_%';
--> statement-breakpoint
INSERT INTO "activity_events" ("steam_id", "kind", "mode", "ref", "at")
SELECT s, 'cup_signup', t."mode"::text, t."id"::text, e."created_at"
FROM "tournament_entries" e JOIN "tournaments" t ON t."id" = e."tournament_id", unnest(e."steam_ids") s;
--> statement-breakpoint
INSERT INTO "user_activity" (
  "steam_id", "queue_joins", "queue_seconds", "matches_found", "matches_accepted", "matches_declined", "matches_missed",
  "matches_played", "matches_won", "cup_signups", "first_seen_at", "last_seen_at",
  "last_action", "last_action_detail", "last_action_mode", "last_action_at"
)
SELECT u."steam_id",
  count(e.*) FILTER (WHERE e."kind" = 'queue_join'),
  coalesce(sum(e."value") FILTER (WHERE e."kind" IN ('queue_leave', 'queue_matched')), 0),
  count(e.*) FILTER (WHERE e."kind" = 'match_found'),
  count(e.*) FILTER (WHERE e."kind" = 'match_accept'),
  count(e.*) FILTER (WHERE e."kind" = 'match_decline'),
  count(e.*) FILTER (WHERE e."kind" = 'match_missed'),
  count(e.*) FILTER (WHERE e."kind" = 'match_end' AND e."detail" IN ('win', 'loss')),
  count(e.*) FILTER (WHERE e."kind" = 'match_end' AND e."detail" = 'win'),
  count(e.*) FILTER (WHERE e."kind" = 'cup_signup'),
  u."created_at",
  greatest(u."last_login_at", max(e."at")),
  l."kind", l."detail", l."mode", l."at"
FROM "users" u
LEFT JOIN "activity_events" e ON e."steam_id" = u."steam_id"
LEFT JOIN LATERAL (
  SELECT x."kind", x."detail", x."mode", x."at" FROM "activity_events" x
  WHERE x."steam_id" = u."steam_id" ORDER BY x."at" DESC, x."id" DESC LIMIT 1
) l ON true
GROUP BY u."steam_id", u."created_at", u."last_login_at", l."kind", l."detail", l."mode", l."at";
