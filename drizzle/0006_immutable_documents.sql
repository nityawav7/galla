-- Issued invoices and credit notes are immutable (CLAUDE.md rule 5, ADR 0006).
-- invoice.service never changes them; these triggers are the last line of defence against any
-- other code path or a manual query. Messages name ids only, never customer data.

-- After issue, only these invoice columns may change: payment and credit progress, cancelling,
-- and the public link. Every other column (including any added later) is frozen.
CREATE FUNCTION galla_guard_issued_invoice() RETURNS trigger
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
CREATE TRIGGER invoices_guard_issued
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION galla_guard_issued_invoice();
--> statement-breakpoint

-- Lines can only be written while their invoice is a draft. Issuing inserts the lines first and
-- then flips the status, in one transaction.
CREATE FUNCTION galla_guard_invoice_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line invoice_lines%ROWTYPE := COALESCE(NEW, OLD);
  parent_status text;
BEGIN
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
CREATE TRIGGER invoice_lines_guard_issued
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION galla_guard_invoice_lines();
--> statement-breakpoint

-- Credit notes are issued directly and never change, like the audit log.
CREATE FUNCTION galla_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only (% of %)', TG_TABLE_NAME, TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credit_notes_append_only
  BEFORE UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION galla_append_only();
--> statement-breakpoint
CREATE TRIGGER credit_note_lines_append_only
  BEFORE UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION galla_append_only();
