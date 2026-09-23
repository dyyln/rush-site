DROP INDEX "flags_player_match_idx";--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "flags_player_match_active_idx" ON "flags" USING btree ("steam_id","match_id") WHERE "flags"."match_id" is not null and "flags"."status" = 'open';--> statement-breakpoint
CREATE INDEX "flags_match_idx" ON "flags" USING btree ("match_id","steam_id");--> statement-breakpoint
UPDATE "flags" SET "claimed_at" = now() WHERE "status"::text = 'reviewing';