CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"diff" jsonb,
	"ip_hash" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_entity_not_blank" CHECK (length("audit_logs"."entity") > 0),
	CONSTRAINT "audit_logs_action_not_blank" CHECK (length("audit_logs"."action") > 0)
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"gstin" text,
	"gst_scheme" text NOT NULL,
	"state_code" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"pincode" text,
	"phone_e164" text,
	"email" text,
	"logo_url" text,
	"signature_url" text,
	"upi_vpa" text,
	"bank_account_name" text,
	"bank_account_number" text,
	"bank_ifsc" text,
	"bank_name" text,
	"invoice_prefix" text DEFAULT 'INV' NOT NULL,
	"credit_note_prefix" text DEFAULT 'CN' NOT NULL,
	"terms" text,
	"hsn_digits_required" smallint DEFAULT 4 NOT NULL,
	"round_off_enabled" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "businesses_slug_format" CHECK ("businesses"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
	CONSTRAINT "businesses_gst_scheme" CHECK ("businesses"."gst_scheme" in ('REGULAR', 'COMPOSITION', 'UNREGISTERED')),
	CONSTRAINT "businesses_gstin_matches_scheme" CHECK (("businesses"."gst_scheme" = 'UNREGISTERED') = ("businesses"."gstin" is null)),
	CONSTRAINT "businesses_gstin_format" CHECK ("businesses"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "businesses_gstin_state" CHECK (left("businesses"."gstin", 2) = "businesses"."state_code"),
	CONSTRAINT "businesses_pincode_format" CHECK ("businesses"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "businesses_phone_format" CHECK ("businesses"."phone_e164" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "businesses_invoice_prefix_format" CHECK ("businesses"."invoice_prefix" ~ '^[A-Za-z0-9-]{1,5}$'),
	CONSTRAINT "businesses_credit_note_prefix_format" CHECK ("businesses"."credit_note_prefix" ~ '^[A-Za-z0-9-]{1,5}$'),
	CONSTRAINT "businesses_prefixes_differ" CHECK (lower("businesses"."invoice_prefix") <> lower("businesses"."credit_note_prefix")),
	CONSTRAINT "businesses_hsn_digits" CHECK ("businesses"."hsn_digits_required" in (4, 6)),
	CONSTRAINT "businesses_locale" CHECK ("businesses"."locale" in ('en', 'hi'))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text,
	"email" text,
	"gstin" text,
	"billing_address_line1" text,
	"billing_address_line2" text,
	"billing_city" text,
	"billing_pincode" text,
	"billing_state_code" text,
	"shipping_address_line1" text,
	"shipping_address_line2" text,
	"shipping_city" text,
	"shipping_pincode" text,
	"shipping_state_code" text,
	"opening_balance_paise" bigint DEFAULT 0 NOT NULL,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "customers_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "customers_name_not_blank" CHECK (length(trim("customers"."name")) > 0),
	CONSTRAINT "customers_phone_format" CHECK ("customers"."phone_e164" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "customers_gstin_format" CHECK ("customers"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "customers_billing_pincode_format" CHECK ("customers"."billing_pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "customers_shipping_pincode_format" CHECK ("customers"."shipping_pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "customers_credit_days_range" CHECK ("customers"."credit_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hsn_sac" text,
	"unit" text NOT NULL,
	"price_paise" bigint NOT NULL,
	"rate_bp" integer NOT NULL,
	"price_includes_tax" boolean DEFAULT false NOT NULL,
	"sku" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "products_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "products_name_not_blank" CHECK (length(trim("products"."name")) > 0),
	CONSTRAINT "products_hsn_sac_format" CHECK ("products"."hsn_sac" ~ '^[0-9]{4,8}$'),
	CONSTRAINT "products_price_non_negative" CHECK ("products"."price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"product_id" uuid,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"hsn_sac" text,
	"unit" text NOT NULL,
	"qty_milli" bigint NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"price_includes_tax" boolean NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"rate_bp" integer NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"utgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "credit_note_lines_credit_note_position_unique" UNIQUE("business_id","credit_note_id","position"),
	CONSTRAINT "credit_note_lines_tax_split" CHECK (("credit_note_lines"."igst_paise" = 0 and "credit_note_lines"."cgst_paise" = "credit_note_lines"."sgst_paise" + "credit_note_lines"."utgst_paise" and ("credit_note_lines"."sgst_paise" = 0 or "credit_note_lines"."utgst_paise" = 0))
      or ("credit_note_lines"."cgst_paise" = 0 and "credit_note_lines"."sgst_paise" = 0 and "credit_note_lines"."utgst_paise" = 0)),
	CONSTRAINT "credit_note_lines_amounts_non_negative" CHECK ("credit_note_lines"."taxable_paise" >= 0 and "credit_note_lines"."cgst_paise" >= 0 and "credit_note_lines"."sgst_paise" >= 0 and "credit_note_lines"."utgst_paise" >= 0 and "credit_note_lines"."igst_paise" >= 0),
	CONSTRAINT "credit_note_lines_position_positive" CHECK ("credit_note_lines"."position" >= 1),
	CONSTRAINT "credit_note_lines_description_not_blank" CHECK (length(trim("credit_note_lines"."description")) > 0),
	CONSTRAINT "credit_note_lines_hsn_sac_format" CHECK ("credit_note_lines"."hsn_sac" ~ '^[0-9]{4,8}$'),
	CONSTRAINT "credit_note_lines_unit_format" CHECK ("credit_note_lines"."unit" ~ '^[A-Z]{3}$'),
	CONSTRAINT "credit_note_lines_qty_positive" CHECK ("credit_note_lines"."qty_milli" > 0),
	CONSTRAINT "credit_note_lines_unit_price_non_negative" CHECK ("credit_note_lines"."unit_price_paise" >= 0),
	CONSTRAINT "credit_note_lines_discount_non_negative" CHECK ("credit_note_lines"."discount_paise" >= 0),
	CONSTRAINT "credit_note_lines_rate_bp_range" CHECK ("credit_note_lines"."rate_bp" >= 0 and "credit_note_lines"."rate_bp" < 10000),
	CONSTRAINT "credit_note_lines_line_total" CHECK ("credit_note_lines"."line_total_paise" = "credit_note_lines"."taxable_paise" + "credit_note_lines"."cgst_paise" + "credit_note_lines"."sgst_paise" + "credit_note_lines"."utgst_paise" + "credit_note_lines"."igst_paise")
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"note_date" date NOT NULL,
	"reason" text NOT NULL,
	"customer_snapshot" jsonb NOT NULL,
	"place_of_supply_state_code" text NOT NULL,
	"is_inter_state" boolean NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"utgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"grand_total_paise" bigint DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "credit_notes_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "credit_notes_business_id_number_unique" UNIQUE("business_id","number"),
	CONSTRAINT "credit_notes_tax_split" CHECK (("credit_notes"."igst_paise" = 0 and "credit_notes"."cgst_paise" = "credit_notes"."sgst_paise" + "credit_notes"."utgst_paise" and ("credit_notes"."sgst_paise" = 0 or "credit_notes"."utgst_paise" = 0))
      or ("credit_notes"."cgst_paise" = 0 and "credit_notes"."sgst_paise" = 0 and "credit_notes"."utgst_paise" = 0)),
	CONSTRAINT "credit_notes_amounts_non_negative" CHECK ("credit_notes"."taxable_paise" >= 0 and "credit_notes"."cgst_paise" >= 0 and "credit_notes"."sgst_paise" >= 0 and "credit_notes"."utgst_paise" >= 0 and "credit_notes"."igst_paise" >= 0),
	CONSTRAINT "credit_notes_discount_non_negative" CHECK ("credit_notes"."discount_paise" >= 0),
	CONSTRAINT "credit_notes_place_of_supply_tax" CHECK (("credit_notes"."is_inter_state" and "credit_notes"."cgst_paise" = 0 and "credit_notes"."sgst_paise" = 0 and "credit_notes"."utgst_paise" = 0)
        or (not "credit_notes"."is_inter_state" and "credit_notes"."igst_paise" = 0)),
	CONSTRAINT "credit_notes_round_off_range" CHECK ("credit_notes"."round_off_paise" between -49 and 50),
	CONSTRAINT "credit_notes_grand_total" CHECK ("credit_notes"."grand_total_paise" = "credit_notes"."taxable_paise" + "credit_notes"."cgst_paise" + "credit_notes"."sgst_paise" + "credit_notes"."utgst_paise" + "credit_notes"."igst_paise" + "credit_notes"."round_off_paise"),
	CONSTRAINT "credit_notes_number_format" CHECK ("credit_notes"."number" ~ '^[A-Za-z0-9/-]{1,16}$'),
	CONSTRAINT "credit_notes_fy_format" CHECK ("credit_notes"."fy" ~ '^[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "credit_notes_reason_not_blank" CHECK (length(trim("credit_notes"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"hsn_sac" text,
	"unit" text NOT NULL,
	"qty_milli" bigint NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"price_includes_tax" boolean NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"rate_bp" integer NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"utgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "invoice_lines_invoice_position_unique" UNIQUE("business_id","invoice_id","position"),
	CONSTRAINT "invoice_lines_tax_split" CHECK (("invoice_lines"."igst_paise" = 0 and "invoice_lines"."cgst_paise" = "invoice_lines"."sgst_paise" + "invoice_lines"."utgst_paise" and ("invoice_lines"."sgst_paise" = 0 or "invoice_lines"."utgst_paise" = 0))
      or ("invoice_lines"."cgst_paise" = 0 and "invoice_lines"."sgst_paise" = 0 and "invoice_lines"."utgst_paise" = 0)),
	CONSTRAINT "invoice_lines_amounts_non_negative" CHECK ("invoice_lines"."taxable_paise" >= 0 and "invoice_lines"."cgst_paise" >= 0 and "invoice_lines"."sgst_paise" >= 0 and "invoice_lines"."utgst_paise" >= 0 and "invoice_lines"."igst_paise" >= 0),
	CONSTRAINT "invoice_lines_position_positive" CHECK ("invoice_lines"."position" >= 1),
	CONSTRAINT "invoice_lines_description_not_blank" CHECK (length(trim("invoice_lines"."description")) > 0),
	CONSTRAINT "invoice_lines_hsn_sac_format" CHECK ("invoice_lines"."hsn_sac" ~ '^[0-9]{4,8}$'),
	CONSTRAINT "invoice_lines_unit_format" CHECK ("invoice_lines"."unit" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoice_lines_qty_positive" CHECK ("invoice_lines"."qty_milli" > 0),
	CONSTRAINT "invoice_lines_unit_price_non_negative" CHECK ("invoice_lines"."unit_price_paise" >= 0),
	CONSTRAINT "invoice_lines_discount_non_negative" CHECK ("invoice_lines"."discount_paise" >= 0),
	CONSTRAINT "invoice_lines_rate_bp_range" CHECK ("invoice_lines"."rate_bp" >= 0 and "invoice_lines"."rate_bp" < 10000),
	CONSTRAINT "invoice_lines_line_total" CHECK ("invoice_lines"."line_total_paise" = "invoice_lines"."taxable_paise" + "invoice_lines"."cgst_paise" + "invoice_lines"."sgst_paise" + "invoice_lines"."utgst_paise" + "invoice_lines"."igst_paise")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"number" text,
	"fy" text,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"customer_id" uuid,
	"customer_snapshot" jsonb,
	"place_of_supply_state_code" text NOT NULL,
	"is_inter_state" boolean NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"utgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"grand_total_paise" bigint DEFAULT 0 NOT NULL,
	"amount_paid_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"public_token" text,
	"token_revoked_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "invoices_publicToken_unique" UNIQUE("public_token"),
	CONSTRAINT "invoices_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "invoices_business_id_number_unique" UNIQUE("business_id","number"),
	CONSTRAINT "invoices_type" CHECK ("invoices"."type" in ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE')),
	CONSTRAINT "invoices_status" CHECK ("invoices"."status" in ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
	CONSTRAINT "invoices_tax_only_on_tax_invoice" CHECK ("invoices"."type" = 'TAX_INVOICE' or ("invoices"."cgst_paise" = 0 and "invoices"."sgst_paise" = 0 and "invoices"."utgst_paise" = 0 and "invoices"."igst_paise" = 0)),
	CONSTRAINT "invoices_tax_split" CHECK (("invoices"."igst_paise" = 0 and "invoices"."cgst_paise" = "invoices"."sgst_paise" + "invoices"."utgst_paise" and ("invoices"."sgst_paise" = 0 or "invoices"."utgst_paise" = 0))
      or ("invoices"."cgst_paise" = 0 and "invoices"."sgst_paise" = 0 and "invoices"."utgst_paise" = 0)),
	CONSTRAINT "invoices_amounts_non_negative" CHECK ("invoices"."taxable_paise" >= 0 and "invoices"."cgst_paise" >= 0 and "invoices"."sgst_paise" >= 0 and "invoices"."utgst_paise" >= 0 and "invoices"."igst_paise" >= 0),
	CONSTRAINT "invoices_discount_non_negative" CHECK ("invoices"."discount_paise" >= 0),
	CONSTRAINT "invoices_place_of_supply_tax" CHECK (("invoices"."is_inter_state" and "invoices"."cgst_paise" = 0 and "invoices"."sgst_paise" = 0 and "invoices"."utgst_paise" = 0)
        or (not "invoices"."is_inter_state" and "invoices"."igst_paise" = 0)),
	CONSTRAINT "invoices_round_off_range" CHECK ("invoices"."round_off_paise" between -49 and 50),
	CONSTRAINT "invoices_grand_total" CHECK ("invoices"."grand_total_paise" = "invoices"."taxable_paise" + "invoices"."cgst_paise" + "invoices"."sgst_paise" + "invoices"."utgst_paise" + "invoices"."igst_paise" + "invoices"."round_off_paise"),
	CONSTRAINT "invoices_amount_paid_range" CHECK ("invoices"."amount_paid_paise" >= 0 and "invoices"."amount_paid_paise" <= "invoices"."grand_total_paise"),
	CONSTRAINT "invoices_number_iff_issued" CHECK (("invoices"."status" = 'DRAFT') = ("invoices"."number" is null)),
	CONSTRAINT "invoices_fy_with_number" CHECK (("invoices"."number" is null) = ("invoices"."fy" is null)),
	CONSTRAINT "invoices_issued_at_iff_issued" CHECK (("invoices"."status" = 'DRAFT') = ("invoices"."issued_at" is null)),
	CONSTRAINT "invoices_snapshot_when_issued" CHECK ("invoices"."status" = 'DRAFT' or "invoices"."customer_snapshot" is not null),
	CONSTRAINT "invoices_number_format" CHECK ("invoices"."number" ~ '^[A-Za-z0-9/-]{1,16}$'),
	CONSTRAINT "invoices_fy_format" CHECK ("invoices"."fy" ~ '^[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "invoices_cancelled_at_iff_cancelled" CHECK (("invoices"."status" = 'CANCELLED') = ("invoices"."cancelled_at" is not null)),
	CONSTRAINT "invoices_cancel_reason_when_cancelled" CHECK ("invoices"."status" <> 'CANCELLED' or coalesce(length(trim("invoices"."cancel_reason")), 0) > 0),
	CONSTRAINT "invoices_due_date_after_invoice_date" CHECK ("invoices"."due_date" >= "invoices"."invoice_date"),
	CONSTRAINT "invoices_public_token_format" CHECK ("invoices"."public_token" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "invoices_version_positive" CHECK ("invoices"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"series" text NOT NULL,
	"fy" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "number_sequences_business_id_series_fy_unique" UNIQUE("business_id","series","fy"),
	CONSTRAINT "number_sequences_series" CHECK ("number_sequences"."series" in ('INV', 'CN')),
	CONSTRAINT "number_sequences_fy_format" CHECK ("number_sequences"."fy" ~ '^[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "number_sequences_next_value_positive" CHECK ("number_sequences"."next_value" >= 1)
);
--> statement-breakpoint
CREATE TABLE "reminders_sent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "reminders_sent_invoice_kind_channel_unique" UNIQUE("business_id","invoice_id","kind","channel"),
	CONSTRAINT "reminders_sent_kind" CHECK ("reminders_sent"."kind" in ('DUE', 'D1', 'D7', 'D14')),
	CONSTRAINT "reminders_sent_channel" CHECK ("reminders_sent"."channel" in ('EMAIL', 'WHATSAPP'))
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "payment_allocations_payment_invoice_unique" UNIQUE("business_id","payment_id","invoice_id"),
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("payment_allocations"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid,
	"payment_date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"mode" text NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "payments_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_paise" > 0),
	CONSTRAINT "payments_mode" CHECK ("payments"."mode" in ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "states" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_ut_without_legislature" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "states_code_format" CHECK ("states"."code" ~ '^[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"rate_bp" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tax_rates_rate_bp_range" CHECK ("tax_rates"."rate_bp" >= 0 and "tax_rates"."rate_bp" < 10000)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"uqc_code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "units_uqc_code_format" CHECK ("units"."uqc_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_state_code_states_code_fk" FOREIGN KEY ("state_code") REFERENCES "public"."states"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_billing_state_code_states_code_fk" FOREIGN KEY ("billing_state_code") REFERENCES "public"."states"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_shipping_state_code_states_code_fk" FOREIGN KEY ("shipping_state_code") REFERENCES "public"."states"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_unit_units_uqc_code_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("uqc_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_rate_bp_tax_rates_rate_bp_fk" FOREIGN KEY ("rate_bp") REFERENCES "public"."tax_rates"("rate_bp") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_fk" FOREIGN KEY ("business_id","credit_note_id") REFERENCES "public"."credit_notes"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_product_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."products"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_place_of_supply_state_code_states_code_fk" FOREIGN KEY ("place_of_supply_state_code") REFERENCES "public"."states"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_fk" FOREIGN KEY ("business_id","invoice_id") REFERENCES "public"."invoices"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("business_id","invoice_id") REFERENCES "public"."invoices"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."products"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_place_of_supply_state_code_states_code_fk" FOREIGN KEY ("place_of_supply_state_code") REFERENCES "public"."states"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_invoice_fk" FOREIGN KEY ("business_id","invoice_id") REFERENCES "public"."invoices"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fk" FOREIGN KEY ("business_id","payment_id") REFERENCES "public"."payments"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_fk" FOREIGN KEY ("business_id","invoice_id") REFERENCES "public"."invoices"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_business_id_at_idx" ON "audit_logs" USING btree ("business_id","at");--> statement-breakpoint
CREATE INDEX "audit_logs_business_id_entity_idx" ON "audit_logs" USING btree ("business_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "businesses_state_code_idx" ON "businesses" USING btree ("state_code");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_business_id_gstin_unique" ON "customers" USING btree ("business_id","gstin") WHERE "customers"."gstin" is not null and "customers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "customers_business_id_phone_idx" ON "customers" USING btree ("business_id","phone_e164");--> statement-breakpoint
CREATE INDEX "customers_business_id_created_at_idx" ON "customers" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_billing_state_code_idx" ON "customers" USING btree ("billing_state_code");--> statement-breakpoint
CREATE INDEX "customers_shipping_state_code_idx" ON "customers" USING btree ("shipping_state_code");--> statement-breakpoint
CREATE UNIQUE INDEX "products_business_id_sku_unique" ON "products" USING btree ("business_id","sku") WHERE "products"."sku" is not null and "products"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "products_business_id_created_at_idx" ON "products" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_unit_idx" ON "products" USING btree ("unit");--> statement-breakpoint
CREATE INDEX "products_rate_bp_idx" ON "products" USING btree ("rate_bp");--> statement-breakpoint
CREATE INDEX "credit_note_lines_business_id_product_id_idx" ON "credit_note_lines" USING btree ("business_id","product_id");--> statement-breakpoint
CREATE INDEX "credit_notes_business_id_created_at_idx" ON "credit_notes" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_notes_business_id_note_date_idx" ON "credit_notes" USING btree ("business_id","note_date");--> statement-breakpoint
CREATE INDEX "credit_notes_business_id_invoice_id_idx" ON "credit_notes" USING btree ("business_id","invoice_id");--> statement-breakpoint
CREATE INDEX "credit_notes_business_id_customer_id_idx" ON "credit_notes" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE INDEX "credit_notes_place_of_supply_state_code_idx" ON "credit_notes" USING btree ("place_of_supply_state_code");--> statement-breakpoint
CREATE INDEX "invoice_lines_business_id_product_id_idx" ON "invoice_lines" USING btree ("business_id","product_id");--> statement-breakpoint
CREATE INDEX "invoices_business_id_created_at_idx" ON "invoices" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_business_id_status_idx" ON "invoices" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "invoices_business_id_invoice_date_idx" ON "invoices" USING btree ("business_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_business_id_customer_id_idx" ON "invoices" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE INDEX "invoices_place_of_supply_state_code_idx" ON "invoices" USING btree ("place_of_supply_state_code");--> statement-breakpoint
CREATE INDEX "payment_allocations_business_id_invoice_id_idx" ON "payment_allocations" USING btree ("business_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_business_id_created_at_idx" ON "payments" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_business_id_payment_date_idx" ON "payments" USING btree ("business_id","payment_date");--> statement-breakpoint
CREATE INDEX "payments_business_id_customer_id_idx" ON "payments" USING btree ("business_id","customer_id");