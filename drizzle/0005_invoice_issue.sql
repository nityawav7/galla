ALTER TABLE "invoices" DROP CONSTRAINT "invoices_amount_paid_range";--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "supplier_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supplier_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amount_credited_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill rows written before this migration (none in production; test and dev databases may
-- have some), so the new CHECKs hold for every row. Hand-written, not generated.
UPDATE "invoices" SET "draft" = jsonb_build_object(
  'customerId', "customer_id", 'walkInName', '', 'placeOfSupplyOverride', null,
  'dueDate', "due_date", 'notes', coalesce("notes", ''), 'lines', '[]'::jsonb
) WHERE "status" = 'DRAFT';--> statement-breakpoint
UPDATE "invoices" AS i SET "supplier_snapshot" = jsonb_build_object(
  'legalName', b."legal_name", 'tradeName', b."trade_name", 'gstin', b."gstin",
  'gstScheme', b."gst_scheme", 'stateCode', b."state_code",
  'address', jsonb_build_object('line1', b."address_line1", 'line2', b."address_line2",
    'city', b."city", 'pincode', b."pincode", 'stateCode', b."state_code"),
  'phoneE164', b."phone_e164", 'email', b."email", 'logoUrl', b."logo_url",
  'signatureUrl', b."signature_url"
) FROM "businesses" AS b WHERE b."id" = i."business_id" AND i."status" <> 'DRAFT';--> statement-breakpoint
UPDATE "credit_notes" AS c SET "supplier_snapshot" = jsonb_build_object(
  'legalName', b."legal_name", 'tradeName', b."trade_name", 'gstin', b."gstin",
  'gstScheme', b."gst_scheme", 'stateCode', b."state_code",
  'address', jsonb_build_object('line1', b."address_line1", 'line2', b."address_line2",
    'city', b."city", 'pincode', b."pincode", 'stateCode', b."state_code"),
  'phoneE164', b."phone_e164", 'email', b."email", 'logoUrl', b."logo_url",
  'signatureUrl', b."signature_url"
) FROM "businesses" AS b WHERE b."id" = c."business_id";--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "supplier_snapshot" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_business_id_invoice_date_id_idx" ON "invoices" USING btree ("business_id","invoice_date","id");--> statement-breakpoint
CREATE INDEX "invoices_business_id_due_date_open_idx" ON "invoices" USING btree ("business_id","due_date") WHERE "invoices"."status" in ('ISSUED', 'PARTIALLY_PAID');--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_settled_range" CHECK ("invoices"."amount_paid_paise" >= 0 and "invoices"."amount_credited_paise" >= 0 and "invoices"."amount_paid_paise" + "invoices"."amount_credited_paise" <= "invoices"."grand_total_paise");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_snapshot_when_issued" CHECK ("invoices"."status" = 'DRAFT' or "invoices"."supplier_snapshot" is not null);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_draft_iff_draft" CHECK (("invoices"."status" = 'DRAFT') = ("invoices"."draft" is not null));