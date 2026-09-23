CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"created_by" text NOT NULL,
	"target_steam_id" text,
	"rematch_of_match_id" uuid,
	"code" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"match_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenges_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX "challenges_status_expires_idx" ON "challenges" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "challenges_created_by_idx" ON "challenges" USING btree ("created_by","status");--> statement-breakpoint
CREATE INDEX "challenges_target_idx" ON "challenges" USING btree ("target_steam_id","status");--> statement-breakpoint
CREATE INDEX "challenges_rematch_idx" ON "challenges" USING btree ("rematch_of_match_id");
