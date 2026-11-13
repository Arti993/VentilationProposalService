ALTER TABLE "estimates" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_items" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "price_items" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "estimates_pending_idx" ON "estimates" USING btree ("created_at") WHERE notified_at is null;