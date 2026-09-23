CREATE TABLE "user_settings" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"min_trust" text DEFAULT 'new' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD COLUMN "min_trust" "trust_level" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_tickets" ADD COLUMN "player_trust" jsonb DEFAULT '{}'::jsonb NOT NULL;