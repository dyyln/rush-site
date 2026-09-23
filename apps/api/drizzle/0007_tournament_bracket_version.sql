ALTER TABLE "bracket_matches" ADD COLUMN "provisioning_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "bracket_version" integer DEFAULT 0 NOT NULL;