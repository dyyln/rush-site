CREATE TYPE "public"."report_outcome" AS ENUM('received', 'reviewed', 'actioned', 'dismissed');--> statement-breakpoint
ALTER TYPE "public"."flag_status" ADD VALUE 'reviewing';--> statement-breakpoint
ALTER TYPE "public"."flag_status" ADD VALUE 'cleared';--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "reviewer_steam_id" text;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "outcome" "report_outcome" DEFAULT 'received' NOT NULL;--> statement-breakpoint
CREATE INDEX "flags_status_idx" ON "flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flags_player_match_idx" ON "flags" USING btree ("steam_id","match_id") WHERE "flags"."match_id" is not null;--> statement-breakpoint
CREATE INDEX "reports_target_match_idx" ON "reports" USING btree ("reported_steam_id","match_id");--> statement-breakpoint
UPDATE "reports" SET "outcome" = "status"::text::"report_outcome" WHERE "status" IN ('actioned', 'dismissed');