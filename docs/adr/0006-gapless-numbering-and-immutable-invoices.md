# ADR 0006: Gapless numbering at issue, and immutable invoices

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

GST invoice numbers must be consecutive within a financial year and never reused (SPEC §4.6, Rule 46). A shop's counter staff and owner may issue invoices at the same moment, on a phone with a flaky connection that retries, or by double-tapping "Issue". An issued invoice is a legal record: changing its amounts, its customer or its lines afterwards is never allowed, only cancelling it or issuing a credit note (CLAUDE.md rule 5).

## Decision

- **Drafts are working copies.** A draft keeps what the builder holds as JSON in `invoices.draft`, half-typed lines included, and has no number. Totals on the draft row count only its valid lines, for the list. `invoice_lines` rows are written only when issuing, as snapshots. Autosave uses optimistic locking on `version` and writes no audit row (Phase 6 plan, decision 3).
- **Issue is one transaction**, in this order:
  1. `SELECT … FOR UPDATE` on the invoice row. A second issue of the same draft waits, then finds it issued (Conflict).
  2. Load the business, customer and products **inside the tenant**, and recompute every line and total from the stored draft with the domain engine. The client never sends totals. Product lines take their HSN, unit, rate and "price includes tax" from the product.
  3. Check the issue rules (HSN digits, Rule 46 recipient details). Warnings that need confirmation (unregistered business billing another state) return `needsConfirmation` and write nothing.
  4. Insert the line snapshots while the invoice is still a draft.
  5. **Take the number last**, with one statement:
     `INSERT INTO number_sequences … ON CONFLICT (business_id, series, fy) DO UPDATE SET next_value = next_value + 1 RETURNING next_value - 1`.
     The upsert creates the counter for a new FY without a race, and the row lock it takes lasts until commit. Concurrent issues in one business wait only for steps 5–6 of each other. If anything fails, the rollback undoes the increment, so a number is never skipped.
  6. Mark the invoice issued (number, FY, type, totals, customer and **supplier** snapshots, a 128-bit public token) and write the `invoice.issued` audit row in the same transaction.
- **The FY and invoice date come from the issue moment in Asia/Kolkata** (`src/server/clock.ts`), with no backdating in v1, so numbers stay in date order.
- **The database guards immutability** (`drizzle/0006_immutable_documents.sql`), as the last line of defence:
  - After issue, only `status`, `amount_paid_paise`, `amount_credited_paise`, the cancel fields, the public-token fields, `updated_at` and `version` may change. The trigger compares the whole row minus those columns, so a column added later is frozen by default. An issued invoice can't go back to draft, and a cancelled one stays cancelled.
  - Issued invoices can't be deleted. Lines can only be written while their invoice is a draft.
  - Credit notes and their lines are append-only.
  - Violations raise SQLSTATE `23001` (`restrict_violation`) with ids only, never customer data.
- **Snapshots.** The customer (name, GSTIN, addresses) and the business (name, address, GSTIN, scheme, logo and signature URLs) are copied onto the invoice at issue. Later edits change only future invoices.

## Consequences

- An integration test issues 50 drafts in parallel and gets exactly 0001–0050. Another issues one draft twice at once and gets one invoice.
- Issues within one business are serialised on the counter row. At shop scale (a few invoices a minute) that's invisible. Different businesses never wait for each other.
- A changed prefix applies to the next number; the counter is per series and FY, not per prefix.
- Totals of an old draft can change when it is issued, if a product's rate or the business's scheme changed meanwhile. That's intended: the server is the source of truth at issue.
- Fixing a wrong issued invoice always means cancelling it or a credit note (Phase 6c). `docs/runbook.md` explains how to check numbering and why numbers are never edited.
