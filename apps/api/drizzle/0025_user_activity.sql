CREATE TABLE "user_activity_days" (
	"steam_id" text NOT NULL,
	"day" date NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_activity_days_steam_id_day_pk" PRIMARY KEY("steam_id","day")
);
--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_days_steam_id_users_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."users"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_activity_days_day_idx" ON "user_activity_days" USING btree ("day");