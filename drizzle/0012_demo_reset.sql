-- The daily demo reset (ADR 0018) empties the demo business before rebuilding it. Issued
-- invoices and their lines, credit notes, payments and refunds refuse deletes everywhere else
-- (0006, 0009, 0010); these guards now let a DELETE through only when BOTH hold:
--   * the transaction set `SET LOCAL galla.demo_reset = 'on'` (src/server/db/admin/demo.ts), and
--   * the row belongs to a business with is_demo = true.
-- A real business can never be affected, whatever a transaction sets. Updates are unchanged.

CREATE FUNCTION galla_demo_reset_allows(biz uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('galla.demo_reset', true), '') = 'on'
    AND EXISTS (SELECT 1 FROM businesses WHERE id = biz AND is_demo);
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION galla_guard_issued_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY[
    'status', 'amount_paid_paise', 'amount_credited_paise', 'cancelled_at', 'cancel_reason',
    'public_token', 'token_revoked_at', 'updated_at', 'version'
  ];
BEGIN
  IF OLD.status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF galla_demo_reset_allows(OLD.business_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'invoice % is issued and cannot be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'DRAFT' OR (OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'invoice % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'invoice % is issued and cannot be changed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION galla_guard_invoice_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line invoice_lines%ROWTYPE := COALESCE(NEW, OLD);
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' AND galla_demo_reset_allows(OLD.business_id) THEN
    RETURN OLD;
  END IF;
  SELECT status INTO parent_status FROM invoices
    WHERE business_id = line.business_id AND id = line.invoice_id;
  -- No such invoice in this business: let the composite foreign key refuse it.
  IF NOT FOUND THEN
    RETURN line;
  END IF;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'lines of invoice % cannot be changed after issue', line.invoice_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.invoice_id <> NEW.invoice_id OR OLD.business_id <> NEW.business_id) THEN
    RAISE EXCEPTION 'invoice line % cannot move to another invoice', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN line;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION galla_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND galla_demo_reset_allows(OLD.business_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are append-only (% of %)', TG_TABLE_NAME, TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION galla_guard_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['voided_at', 'voided_by', 'void_reason', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF galla_demo_reset_allows(OLD.business_id) THEN
      RETURN OLD;
    END IF;
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

CREATE OR REPLACE FUNCTION galla_guard_refund() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['voided_at', 'voided_by', 'void_reason', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF galla_demo_reset_allows(OLD.business_id) THEN
      RETURN OLD;
    END IF;
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
