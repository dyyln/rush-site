CREATE TABLE "match_maps" (
	"match_id" uuid NOT NULL,
	"map_number" integer NOT NULL,
	"map_id" text NOT NULL,
	"status" text NOT NULL,
	"winner_team" text,
	"score" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"players" jsonb,
	"played_in" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_maps_match_id_map_number_pk" PRIMARY KEY("match_id","map_number")
);
--> statement-breakpoint
ALTER TABLE "demos" ADD COLUMN "map_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "match_kills" ADD COLUMN "map_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "match_rounds" ADD COLUMN "map_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "demos" DROP CONSTRAINT "demos_match_id_unique";--> statement-breakpoint
ALTER TABLE "match_kills" DROP CONSTRAINT "match_kills_match_id_round_tick_victim_steam_id_pk";--> statement-breakpoint
ALTER TABLE "match_rounds" DROP CONSTRAINT "match_rounds_match_id_round_pk";--> statement-breakpoint
ALTER TABLE "match_kills" ADD CONSTRAINT "match_kills_match_id_map_number_round_tick_victim_steam_id_pk" PRIMARY KEY("match_id","map_number","round","tick","victim_steam_id");--> statement-breakpoint
ALTER TABLE "match_rounds" ADD CONSTRAINT "match_rounds_match_id_map_number_round_pk" PRIMARY KEY("match_id","map_number","round");--> statement-breakpoint
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demos_match_map_idx" ON "demos" USING btree ("match_id","map_number");