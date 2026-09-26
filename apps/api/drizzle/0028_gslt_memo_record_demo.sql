ALTER TABLE "gslt_tokens" ADD COLUMN "memo" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "record_demo" boolean DEFAULT true NOT NULL;