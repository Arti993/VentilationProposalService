CREATE TABLE "estimate_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"estimate_id" text NOT NULL,
	"pos_no" integer NOT NULL,
	"line_no" integer NOT NULL,
	"name" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit" text,
	"status" text NOT NULL,
	"unit_price" numeric(12, 2),
	"total" numeric(14, 2),
	"matched_name" text,
	"reason" text,
	"source" text,
	"confidence" numeric(4, 3)
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"total_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"priced_count" integer DEFAULT 0 NOT NULL,
	"not_found_count" integer DEFAULT 0 NOT NULL,
	"needs_human_count" integer DEFAULT 0 NOT NULL,
	"off_topic_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"raw_name" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"type" text NOT NULL,
	"dims_key" text NOT NULL,
	"dims" jsonb NOT NULL,
	"angle" integer,
	"variant" text,
	"unparsed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimate_positions" ADD CONSTRAINT "estimate_positions_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimate_positions_estimate_idx" ON "estimate_positions" USING btree ("estimate_id","pos_no");--> statement-breakpoint
CREATE INDEX "estimates_expires_idx" ON "estimates" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_items_code_uq" ON "price_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "price_items_type_dims_idx" ON "price_items" USING btree ("type","dims_key");