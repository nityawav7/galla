CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid,
	"credit_note_id" uuid,
	"refund_date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"mode" text NOT NULL,
	"reference" text,
	"notes" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "refunds_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_paise" > 0),
	CONSTRAINT "refunds_amount_max" CHECK ("refunds"."amount_paise" <= 10000000000),
	CONSTRAINT "refunds_has_an_owner" CHECK ("refunds"."customer_id" is not null or "refunds"."credit_note_id" is not null),
	CONSTRAINT "refunds_voided_fields" CHECK (("refunds"."voided_at" is null) = ("refunds"."voided_by" is null) and ("refunds"."voided_at" is null) = ("refunds"."void_reason" is null) and ("refunds"."void_reason" is null or length(trim("refunds"."void_reason")) > 0)),
	CONSTRAINT "refunds_mode" CHECK ("refunds"."mode" in ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'))
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_customer_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_credit_note_fk" FOREIGN KEY ("business_id","credit_note_id") REFERENCES "public"."credit_notes"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_business_id_customer_id_date_idx" ON "refunds" USING btree ("business_id","customer_id","refund_date","id");--> statement-breakpoint
CREATE INDEX "refunds_business_id_credit_note_id_idx" ON "refunds" USING btree ("business_id","credit_note_id");--> statement-breakpoint

-- Refunds are never edited or deleted (ADR 0011): the owner voids one, once.
CREATE FUNCTION galla_guard_refund() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['voided_at', 'voided_by', 'void_reason', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refund % cannot be deleted; void it instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'refund % is voided and cannot change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'refund % cannot be changed; void it instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_guard
  BEFORE UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION galla_guard_refund();
--> statement-breakpoint

-- A customer is never refunded more than they have on account: what is left of the opening
-- advance plus what live payments haven't allocated, less live refunds, is never negative.
CREATE FUNCTION galla_assert_customer_credit(biz uuid, cust uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  opening bigint;
  advance_left bigint;
  unallocated bigint;
  refunded bigint;
BEGIN
  IF cust IS NULL THEN
    RETURN;
  END IF;
  SELECT opening_balance_paise INTO opening FROM customers WHERE business_id = biz AND id = cust;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT greatest(-opening, 0) - coalesce(sum(amount_paise), 0) INTO advance_left
    FROM payment_allocations
    WHERE business_id = biz AND customer_id = cust AND payment_id IS NULL;
  SELECT coalesce(sum(p.amount_paise - coalesce(a.allocated, 0)), 0) INTO unallocated
    FROM payments p
    LEFT JOIN (
      SELECT payment_id, sum(amount_paise) AS allocated FROM payment_allocations
        WHERE business_id = biz AND payment_id IS NOT NULL GROUP BY payment_id
    ) a ON a.payment_id = p.id
    WHERE p.business_id = biz AND p.customer_id = cust AND p.voided_at IS NULL;
  SELECT coalesce(sum(amount_paise), 0) INTO refunded FROM refunds
    WHERE business_id = biz AND customer_id = cust AND voided_at IS NULL;
  IF refunded > 0 AND advance_left + unallocated < refunded THEN
    RAISE EXCEPTION 'customer % has % paise refunded but % paise on account', cust, refunded,
      advance_left + unallocated
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION galla_check_customer_credit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cust uuid;
  row_business uuid;
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    PERFORM galla_assert_customer_credit(NEW.business_id, NEW.id);
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    row_business := OLD.business_id;
    cust := OLD.customer_id;
    IF TG_TABLE_NAME = 'payment_allocations' AND cust IS NULL THEN
      SELECT customer_id INTO cust FROM payments
        WHERE business_id = OLD.business_id AND id = OLD.payment_id;
    END IF;
    PERFORM galla_assert_customer_credit(row_business, cust);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    row_business := NEW.business_id;
    cust := NEW.customer_id;
    IF TG_TABLE_NAME = 'payment_allocations' AND cust IS NULL THEN
      SELECT customer_id INTO cust FROM payments
        WHERE business_id = NEW.business_id AND id = NEW.payment_id;
    END IF;
    PERFORM galla_assert_customer_credit(row_business, cust);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refunds_customer_credit_check
  AFTER INSERT OR UPDATE ON refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION galla_check_customer_credit_row();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_customer_credit_check
  AFTER UPDATE ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION galla_check_customer_credit_row();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_allocations_customer_credit_check
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION galla_check_customer_credit_row();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customers_customer_credit_check
  AFTER UPDATE OF opening_balance_paise ON customers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION galla_check_customer_credit_row();
