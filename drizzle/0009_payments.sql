ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_payment_invoice_unique";--> statement-breakpoint
DROP INDEX "credit_notes_business_id_customer_id_idx";--> statement-breakpoint
DROP INDEX "payments_business_id_customer_id_idx";--> statement-breakpoint
ALTER TABLE "payment_allocations" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_customer_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_notes_business_id_customer_id_date_idx" ON "credit_notes" USING btree ("business_id","customer_id","note_date");--> statement-breakpoint
CREATE INDEX "invoices_business_id_customer_id_open_idx" ON "invoices" USING btree ("business_id","customer_id","invoice_date","id") WHERE "invoices"."status" in ('ISSUED', 'PARTIALLY_PAID');--> statement-breakpoint
CREATE INDEX "payment_allocations_business_id_customer_id_idx" ON "payment_allocations" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE INDEX "payments_business_id_customer_id_date_idx" ON "payments" USING btree ("business_id","customer_id","payment_date","id");--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_invoice_unique" UNIQUE NULLS NOT DISTINCT("business_id","payment_id","invoice_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_matches_money" CHECK (case "invoices"."status"
        when 'DRAFT' then "invoices"."amount_paid_paise" = 0 and "invoices"."amount_credited_paise" = 0
        when 'CANCELLED' then "invoices"."amount_paid_paise" = 0
        when 'ISSUED' then "invoices"."amount_paid_paise" = 0
        when 'PARTIALLY_PAID' then "invoices"."amount_paid_paise" > 0 and "invoices"."amount_paid_paise" + "invoices"."amount_credited_paise" < "invoices"."grand_total_paise"
        when 'PAID' then "invoices"."amount_paid_paise" > 0 and "invoices"."amount_paid_paise" + "invoices"."amount_credited_paise" = "invoices"."grand_total_paise"
        else false end);--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_has_an_end" CHECK ("payment_allocations"."payment_id" is not null or "payment_allocations"."invoice_id" is not null);--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_customer_unless_walk_in" CHECK ("payment_allocations"."customer_id" is not null or ("payment_allocations"."payment_id" is not null and "payment_allocations"."invoice_id" is not null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_max" CHECK ("payments"."amount_paise" <= 10000000000);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_fields" CHECK (("payments"."voided_at" is null) = ("payments"."voided_by" is null) and ("payments"."voided_at" is null) = ("payments"."void_reason" is null) and ("payments"."void_reason" is null or length(trim("payments"."void_reason")) > 0));--> statement-breakpoint

-- Payments are never edited or deleted (ADR 0010): the owner voids one, once. Only the void
-- columns may change, and only from not voided to voided. Messages name ids only.
CREATE FUNCTION galla_guard_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['voided_at', 'voided_by', 'void_reason', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment % cannot be deleted; void it instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'payment % is voided and cannot change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'payment % cannot be changed; void it instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_guard
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION galla_guard_payment();
--> statement-breakpoint

-- A live payment never has more allocated than its amount.
CREATE FUNCTION galla_assert_payment_within(biz uuid, pay uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  amount bigint;
  voided timestamptz;
  allocated bigint;
BEGIN
  IF pay IS NULL THEN
    RETURN;
  END IF;
  SELECT amount_paise, voided_at INTO amount, voided FROM payments
    WHERE business_id = biz AND id = pay;
  IF NOT FOUND OR voided IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT coalesce(sum(amount_paise), 0) INTO allocated FROM payment_allocations
    WHERE business_id = biz AND payment_id = pay;
  IF allocated > amount THEN
    RAISE EXCEPTION 'payment % has % paise allocated, more than its % paise', pay, allocated, amount
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint

-- An invoice's amount paid is exactly what live payments and the opening advance allocate to it.
CREATE FUNCTION galla_assert_invoice_paid(biz uuid, inv uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  paid bigint;
  allocated bigint;
BEGIN
  IF inv IS NULL THEN
    RETURN;
  END IF;
  SELECT amount_paid_paise INTO paid FROM invoices WHERE business_id = biz AND id = inv;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT coalesce(sum(a.amount_paise), 0) INTO allocated
    FROM payment_allocations a
    LEFT JOIN payments p ON p.business_id = a.business_id AND p.id = a.payment_id
    WHERE a.business_id = biz AND a.invoice_id = inv
      AND (a.payment_id IS NULL OR p.voided_at IS NULL);
  IF allocated <> paid THEN
    RAISE EXCEPTION 'invoice % has % paise paid but % paise allocated', inv, paid, allocated
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint

-- Checked at commit (deferred), after every row of the transaction is written, so a service may
-- insert allocations and update the invoice in any order.
CREATE FUNCTION galla_check_allocation_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM galla_assert_payment_within(OLD.business_id, OLD.payment_id);
    PERFORM galla_assert_invoice_paid(OLD.business_id, OLD.invoice_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM galla_assert_payment_within(NEW.business_id, NEW.payment_id);
    PERFORM galla_assert_invoice_paid(NEW.business_id, NEW.invoice_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_allocations_check
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION galla_check_allocation_row();
--> statement-breakpoint

CREATE FUNCTION galla_check_payment_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv uuid;
BEGIN
  PERFORM galla_assert_payment_within(NEW.business_id, NEW.id);
  FOR inv IN SELECT invoice_id FROM payment_allocations
      WHERE business_id = NEW.business_id AND payment_id = NEW.id LOOP
    PERFORM galla_assert_invoice_paid(NEW.business_id, inv);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_check
  AFTER INSERT OR UPDATE ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION galla_check_payment_row();
--> statement-breakpoint

CREATE FUNCTION galla_check_invoice_paid_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM galla_assert_invoice_paid(NEW.business_id, NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invoices_paid_check
  AFTER UPDATE OF amount_paid_paise ON invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION galla_check_invoice_paid_row();
