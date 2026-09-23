CREATE TABLE "cup_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cup_key" text NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"cadence" text NOT NULL,
	"weekday" integer,
	"start_time" time NOT NULL,
	"max_entrants" integer NOT NULL,
	"min_trust" text NOT NULL,
	"best_of_final" integer DEFAULT 3 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "team_name" text;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "disqualified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD COLUMN "disqualify_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "cup_schedules_cup_key_uq" ON "cup_schedules" USING btree ("cup_key");--> statement-breakpoint
INSERT INTO "cup_schedules" ("cup_key", "name", "mode", "cadence", "weekday", "start_time", "max_entrants", "min_trust", "best_of_final", "enabled") VALUES
	('daily-aim1v1', 'Daily 1v1 Aim Cup', 'aim1v1', 'daily', NULL, '18:00', 32, 'verified', 3, true),
	('daily-aim2v2', 'Daily 2v2 Aim Cup', 'aim2v2', 'daily', NULL, '18:00', 16, 'verified', 3, true),
	('daily-rush3v3', 'Daily 3v3 Rush Cup', 'rush3v3', 'daily', NULL, '18:00', 16, 'verified', 3, true),
	('weekly-aim1v1', 'Weekly 1v1 Aim Cup', 'aim1v1', 'weekly', 0, '17:00', 64, 'verified', 3, true),
	('weekly-aim2v2', 'Weekly 2v2 Aim Cup', 'aim2v2', 'weekly', 0, '17:00', 32, 'verified', 3, true),
	('weekly-rush3v3', 'Weekly 3v3 Rush Cup', 'rush3v3', 'weekly', 0, '17:00', 32, 'verified', 3, true)
ON CONFLICT ("cup_key") DO NOTHING;
