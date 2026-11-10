ALTER TABLE "businesses" ADD COLUMN "whatsapp_template_en" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "whatsapp_template_hi" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_whatsapp_template_length" CHECK (coalesce(length("businesses"."whatsapp_template_en"), 0) <= 1000 and coalesce(length("businesses"."whatsapp_template_hi"), 0) <= 1000);