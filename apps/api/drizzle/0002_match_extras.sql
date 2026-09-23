CREATE TABLE "match_kills" (
	"match_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"tick" integer NOT NULL,
	"attacker_steam_id" text NOT NULL,
	"victim_steam_id" text NOT NULL,
	"assister_steam_id" text,
	"weapon" text NOT NULL,
	"headshot" boolean NOT NULL,
	"wallbang" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_kills_match_id_round_tick_victim_steam_id_pk" PRIMARY KEY("match_id","round","tick","victim_steam_id")
);
--> statement-breakpoint
ALTER TABLE "match_kills" ADD CONSTRAINT "match_kills_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_kills_attacker_idx" ON "match_kills" USING btree ("attacker_steam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_once_per_match_idx" ON "reports" USING btree ("reporter_steam_id","reported_steam_id","match_id");