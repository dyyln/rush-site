CREATE TABLE "discord_links" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"username" text NOT NULL,
	"global_name" text,
	"avatar" text,
	"discord_created_at" timestamp with time zone NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role_granted" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_error" text,
	CONSTRAINT "discord_links_discord_id_unique" UNIQUE("discord_id")
);
