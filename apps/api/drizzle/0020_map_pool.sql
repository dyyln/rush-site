CREATE TABLE "map_pool" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"workshop_id" text,
	"map_name" text,
	"loadout" jsonb,
	"modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"preview_url" text,
	"source" text NOT NULL,
	"workshop" jsonb,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "map_pool_position_idx" ON "map_pool" USING btree ("position");