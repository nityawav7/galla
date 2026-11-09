ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_business_id_id_unique" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD COLUMN "invoice_line_id" uuid;--> statement-breakpoint
-- Hand-written: link credit-note lines written before this migration (none in production; test
-- databases have some) to their invoice's first line, so the column can be NOT NULL. The rows
-- are append-only, so the guard trigger is paused for this one update only.
ALTER TABLE "credit_note_lines" DISABLE TRIGGER "credit_note_lines_append_only";--> statement-breakpoint
UPDATE "credit_note_lines" AS l SET "invoice_line_id" = (
  SELECT il."id" FROM "invoice_lines" AS il
  JOIN "credit_notes" AS c ON c."business_id" = l."business_id" AND c."id" = l."credit_note_id"
  WHERE il."business_id" = l."business_id" AND il."invoice_id" = c."invoice_id"
  ORDER BY il."position" LIMIT 1
) WHERE l."invoice_line_id" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ENABLE TRIGGER "credit_note_lines_append_only";--> statement-breakpoint
ALTER TABLE "credit_note_lines" ALTER COLUMN "invoice_line_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_fk" FOREIGN KEY ("business_id","invoice_line_id") REFERENCES "public"."invoice_lines"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_note_lines_business_id_invoice_line_id_idx" ON "credit_note_lines" USING btree ("business_id","invoice_line_id");
