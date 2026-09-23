UPDATE "queue_tickets" SET "status" = 'cancelled', "cancel_reason" = 'duplicate', "updated_at" = now() WHERE "status" = 'waiting' AND "id" NOT IN (SELECT DISTINCT ON ("party_id") "id" FROM "queue_tickets" WHERE "status" = 'waiting' ORDER BY "party_id", "enqueued_at" DESC, "id");--> statement-breakpoint
CREATE INDEX "matches_unreleased_ended_idx" ON "matches" USING btree ("ended_at") WHERE "matches"."server_released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "queue_tickets_party_waiting_uq" ON "queue_tickets" USING btree ("party_id") WHERE "queue_tickets"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "queue_tickets_matched_mode_idx" ON "queue_tickets" USING btree ("matched_mode","updated_at") WHERE "queue_tickets"."status" = 'matched';--> statement-breakpoint
CREATE INDEX "vetoes_open_deadline_idx" ON "vetoes" USING btree ("step_deadline") WHERE "vetoes"."done" = false;
