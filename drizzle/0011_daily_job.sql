CREATE TABLE "owner_digests_sent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"digest_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "owner_digests_sent_business_date_unique" UNIQUE("business_id","digest_date")
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "email_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "owner_digest" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_digests_sent" ADD CONSTRAINT "owner_digests_sent_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;