CREATE TYPE "public"."cooldown_reason" AS ENUM('decline', 'accept_timeout', 'no_connect', 'abandon');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."gslt_status" AS ENUM('free', 'in_use', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."host_status" AS ENUM('online', 'offline', 'updating', 'draining');--> statement-breakpoint
CREATE TYPE "public"."match_source" AS ENUM('queue', 'tournament');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('accepting', 'veto', 'allocating', 'starting', 'ready', 'live', 'finished', 'abandoned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('aim1v1', 'aim2v2', 'rush3v3');--> statement-breakpoint
CREATE TYPE "public"."rating_event_reason" AS ENUM('match', 'forfeit', 'rollback', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('free', 'reserved', 'running');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('waiting', 'matched', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trust_level" AS ENUM('new', 'verified', 'trusted');--> statement-breakpoint
CREATE TYPE "public"."review_verdict" AS ENUM('cheat', 'clean');--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_steam_id" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steam_id" text NOT NULL,
	"kind" text NOT NULL,
	"tournament_id" uuid,
	"mode" text,
	"label" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steam_id" text NOT NULL,
	"reason" text NOT NULL,
	"banned_by" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"rollback_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bracket_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bracket_id" uuid NOT NULL,
	"key" text NOT NULL,
	"round" integer NOT NULL,
	"index" integer NOT NULL,
	"best_of" integer NOT NULL,
	"entry_a" uuid,
	"entry_b" uuid,
	"seed_a" integer,
	"seed_b" integer,
	"a_resolved" boolean DEFAULT false NOT NULL,
	"b_resolved" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"games" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"live_match_id" uuid,
	"provision_attempts" integer DEFAULT 0 NOT NULL,
	"winner_entry_id" uuid,
	"resolution" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brackets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"rounds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brackets_tournament_id_unique" UNIQUE("tournament_id")
);
--> statement-breakpoint
CREATE TABLE "cooldowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steam_id" text NOT NULL,
	"reason" "cooldown_reason" NOT NULL,
	"match_id" uuid,
	"offence" integer NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"uploaded" boolean DEFAULT false NOT NULL,
	"keep" boolean DEFAULT false NOT NULL,
	"delete_after" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demos_match_id_unique" UNIQUE("match_id")
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steam_id" text NOT NULL,
	"match_id" uuid,
	"source" text NOT NULL,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gslt_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"status" "gslt_status" DEFAULT 'free' NOT NULL,
	"match_id" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gslt_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"agent_url" text NOT NULL,
	"public_ip" text,
	"status" "host_status" DEFAULT 'offline' NOT NULL,
	"cs2_version" text,
	"total_slots" integer DEFAULT 0 NOT NULL,
	"free_slots" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hosts_agent_url_unique" UNIQUE("agent_url")
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"match_id" uuid NOT NULL,
	"steam_id" text NOT NULL,
	"team" integer NOT NULL,
	"party_id" uuid,
	"ticket_id" uuid,
	"accepted" boolean DEFAULT false NOT NULL,
	"declined" boolean DEFAULT false NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"ever_connected" boolean DEFAULT false NOT NULL,
	"abandoned" boolean DEFAULT false NOT NULL,
	"won" boolean,
	"kills" integer,
	"deaths" integer,
	"headshots" integer,
	"damage" double precision,
	CONSTRAINT "match_players_match_id_steam_id_pk" PRIMARY KEY("match_id","steam_id")
);
--> statement-breakpoint
CREATE TABLE "match_rounds" (
	"match_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"winner_team" text NOT NULL,
	"score" jsonb NOT NULL,
	"arena" text,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_rounds_match_id_round_pk" PRIMARY KEY("match_id","round")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" "mode" NOT NULL,
	"region" text DEFAULT 'eu' NOT NULL,
	"source" "match_source" DEFAULT 'queue' NOT NULL,
	"status" "match_status" NOT NULL,
	"teams" jsonb NOT NULL,
	"maps" jsonb,
	"map_id" text,
	"winner_team" text,
	"score" jsonb,
	"accept_deadline" timestamp with time zone,
	"tournament_id" uuid,
	"bracket_match_key" text,
	"game_number" integer,
	"best_of" integer,
	"driver" text,
	"driver_ref" text,
	"host_id" uuid,
	"slot_id" uuid,
	"gslt_id" uuid,
	"server_ip" text,
	"server_port" integer,
	"connect" text,
	"password" text,
	"webhook_secret" text NOT NULL,
	"allocation_started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"server_released_at" timestamp with time zone,
	"cancel_reason" text,
	"rating_applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leader_steam_id" text NOT NULL,
	"invite_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disbanded_at" timestamp with time zone,
	CONSTRAINT "parties_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "party_members" (
	"party_id" uuid NOT NULL,
	"steam_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_members_party_id_steam_id_pk" PRIMARY KEY("party_id","steam_id")
);
--> statement-breakpoint
CREATE TABLE "queue_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"modes" "mode"[] NOT NULL,
	"region" text DEFAULT 'eu' NOT NULL,
	"steam_ids" text[] NOT NULL,
	"ratings" jsonb NOT NULL,
	"status" "ticket_status" DEFAULT 'waiting' NOT NULL,
	"match_id" uuid,
	"matched_mode" "mode",
	"cancel_reason" text,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "rating_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"match_id" uuid,
	"steam_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"reason" "rating_event_reason" NOT NULL,
	"rating_before" double precision NOT NULL,
	"rd_before" double precision NOT NULL,
	"vol_before" double precision NOT NULL,
	"rating_after" double precision NOT NULL,
	"rd_after" double precision NOT NULL,
	"vol_after" double precision NOT NULL,
	"opp_rating" double precision,
	"opp_rd" double precision,
	"score" double precision,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"steam_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"rating" double precision NOT NULL,
	"rd" double precision NOT NULL,
	"volatility" double precision NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_steam_id_mode_pk" PRIMARY KEY("steam_id","mode")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_steam_id" text NOT NULL,
	"reported_steam_id" text NOT NULL,
	"match_id" uuid,
	"reason" text NOT NULL,
	"detail" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_id" uuid NOT NULL,
	"reviewer_steam_id" text NOT NULL,
	"verdict" "review_verdict" NOT NULL,
	"admin_override" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"slot_index" integer NOT NULL,
	"status" "slot_status" DEFAULT 'free' NOT NULL,
	"match_id" uuid,
	"port" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steam_profiles" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"persona_name" text NOT NULL,
	"avatar_full" text,
	"community_visibility" integer,
	"account_created_at" timestamp with time zone,
	"cs2_playtime_minutes" integer,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"captain_steam_id" text NOT NULL,
	"steam_ids" text[] NOT NULL,
	"seed" integer,
	"rating" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cup_key" text NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"cadence" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"max_entrants" integer NOT NULL,
	"min_trust" text NOT NULL,
	"entry_fee" integer DEFAULT 0 NOT NULL,
	"format" jsonb NOT NULL,
	"registration_opens_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"winner_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_levels" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"level" "trust_level" DEFAULT 'new' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steam_id" text NOT NULL,
	"source" text NOT NULL,
	"clean" boolean NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"profile_url" text,
	"country_code" text,
	"region" text DEFAULT 'eu' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vetoes" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"format" text NOT NULL,
	"state" jsonb NOT NULL,
	"step_deadline" timestamp with time zone,
	"done" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_matches" ADD CONSTRAINT "bracket_matches_bracket_id_brackets_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."brackets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooldowns" ADD CONSTRAINT "cooldowns_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rounds" ADD CONSTRAINT "match_rounds_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_leader_steam_id_users_steam_id_fk" FOREIGN KEY ("leader_steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_steam_id_users_steam_id_fk" FOREIGN KEY ("reporter_steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_steam_id_users_steam_id_fk" FOREIGN KEY ("reported_steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_steam_id_users_steam_id_fk" FOREIGN KEY ("reviewer_steam_id") REFERENCES "public"."users"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_slots" ADD CONSTRAINT "server_slots_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_profiles" ADD CONSTRAINT "steam_profiles_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_levels" ADD CONSTRAINT "trust_levels_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_signals" ADD CONSTRAINT "trust_signals_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vetoes" ADD CONSTRAINT "vetoes_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit" USING btree ("target","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "badges_user_tournament_uq" ON "badges" USING btree ("steam_id","tournament_id");--> statement-breakpoint
CREATE INDEX "badges_steam_idx" ON "badges" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "bans_user_idx" ON "bans" USING btree ("steam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bracket_matches_key_uq" ON "bracket_matches" USING btree ("bracket_id","key");--> statement-breakpoint
CREATE INDEX "bracket_matches_live_idx" ON "bracket_matches" USING btree ("live_match_id");--> statement-breakpoint
CREATE INDEX "cooldowns_user_idx" ON "cooldowns" USING btree ("steam_id","ends_at");--> statement-breakpoint
CREATE INDEX "flags_user_idx" ON "flags" USING btree ("steam_id","status");--> statement-breakpoint
CREATE INDEX "match_players_user_idx" ON "match_players" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "matches_created_idx" ON "matches" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "party_members_user_uq" ON "party_members" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "queue_tickets_status_idx" ON "queue_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "queue_tickets_party_idx" ON "queue_tickets" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "rating_events_user_mode_idx" ON "rating_events" USING btree ("steam_id","mode","seq");--> statement-breakpoint
CREATE INDEX "rating_events_match_idx" ON "rating_events" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "ratings_mode_rating_idx" ON "ratings" USING btree ("mode","rating");--> statement-breakpoint
CREATE UNIQUE INDEX "server_slots_host_idx" ON "server_slots" USING btree ("host_id","slot_index");--> statement-breakpoint
CREATE INDEX "tournament_entries_tournament_idx" ON "tournament_entries" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "tournament_entries_steam_ids_idx" ON "tournament_entries" USING gin ("steam_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_cup_start_uq" ON "tournaments" USING btree ("cup_key","starts_at");--> statement-breakpoint
CREATE INDEX "tournaments_status_start_idx" ON "tournaments" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "trust_signals_user_source_idx" ON "trust_signals" USING btree ("steam_id","source","fetched_at");