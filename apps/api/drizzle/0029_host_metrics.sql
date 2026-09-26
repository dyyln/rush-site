CREATE TABLE "host_metrics" (
	"host_id" uuid NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"slots_total" integer NOT NULL,
	"slots_busy" integer NOT NULL,
	"alloc_pct" double precision,
	"cpu_pct" double precision,
	"load1" double precision,
	"mem_used_bytes" bigint,
	"mem_total_bytes" bigint,
	"disk_used_bytes" bigint,
	"disk_total_bytes" bigint,
	CONSTRAINT "host_metrics_host_id_sampled_at_pk" PRIMARY KEY("host_id","sampled_at")
);
--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "latest_metrics" jsonb;--> statement-breakpoint
ALTER TABLE "host_metrics" ADD CONSTRAINT "host_metrics_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_metrics_sampled_idx" ON "host_metrics" USING btree ("sampled_at");