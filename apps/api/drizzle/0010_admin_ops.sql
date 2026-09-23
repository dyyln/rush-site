CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"dismissible" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"value" jsonb,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"metric" text NOT NULL,
	"mode" text DEFAULT '' NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "metric_samples_metric_mode_sampled_at_pk" PRIMARY KEY("metric","mode","sampled_at")
);
--> statement-breakpoint
CREATE INDEX "announcements_window_idx" ON "announcements" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "metric_samples_sampled_idx" ON "metric_samples" USING btree ("sampled_at");