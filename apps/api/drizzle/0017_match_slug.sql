ALTER TABLE "matches" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_slug_idx" ON "matches" USING btree ("slug");