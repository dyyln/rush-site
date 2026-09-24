CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"steam_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "chat_mutes" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone,
	"reason" text NOT NULL,
	"muted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_messages_channel_created_idx" ON "chat_messages" USING btree ("channel","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_user_idx" ON "chat_messages" USING btree ("steam_id");