CREATE TABLE "admins" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"added_by" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
