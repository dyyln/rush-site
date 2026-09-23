CREATE TABLE "rating_rollbacks" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"cheater_steam_id" text NOT NULL,
	"rolled_back_at" timestamp with time zone NOT NULL
);
