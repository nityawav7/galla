# ADR 0007: Credit notes by returned quantity, and when an invoice can be cancelled

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

An issued invoice never changes (ADR 0006). SPEC §4.8 offers two corrections: cancelling it (owner only, with a reason) or a credit note that reduces what the customer owes. Shops mostly need credit notes for goods coming back. The GST engine rounds every amount to the paisa, so a credit note that recomputes a line from scratch (for example 1 of 3 units) can disagree with the invoice by a paisa, and several partial returns can add up to more or less than the original line.

## Decision

- **A credit-note line returns a quantity of one invoice line** (`credit_note_lines.invoice_line_id`, migration `0007`). It keeps the invoice line's price, rate, discount and tax split; nothing is recalculated from the rate.
- **Amounts are differences of a scaled line.** For a line of quantity Q, the amounts credited once `c` units are back are `F(c)` = each stored amount × c ÷ Q, rounded half up (`src/server/domain/invoice/credit.ts`). Returning `q` more units credits `F(before + q) − F(before)`. Because `F(Q)` is the stored line exactly:
  - any series of returns adds up to the line to the paisa (fast-check property test);
  - CGST and SGST (or UTGST) stay equal, and nothing goes negative.
- **Round-off:** partial credit notes have none. The credit note that returns the last unit of the invoice carries the invoice's round-off, so a fully returned invoice is credited exactly its grand total.
- **Limits:** a credit note can't exceed the invoice's balance (grand total − paid − credited, SPEC §4.8) or return more than is left on a line. It locks the invoice row, so two credit notes at once can't over-credit. It takes the next number of the business's own `CN` series for the FY of its date (ADR 0006), and adds its total to `invoices.amount_credited_paise` in the same transaction as its audit row.
- **Cancelling** is allowed only for an issued invoice with nothing paid or credited (Phase 6 plan, decision 6). The invoice keeps its number and lines, and the reason is required and audited. The dialog warns that an invoice already in a filed GSTR-1 should get a credit note instead (CA question 6).
- Both actions need `invoice:cancel` (owner only, SPEC §2.1).

## Consequences

- A price reduction without goods coming back ("discount after sale") is recorded as a return of part of the quantity. That works for the totals, but not for the quantity on a GSTR-1 HSN summary. An amount-based credit note can be added later if CAs need it.
- A fully paid invoice can't get a credit note until Phase 8 decides how refunds and on-account credit work.
- A partial credit note that would push the credited total past the balance because of the invoice's negative round-off is refused; the owner returns everything instead.
- Credit notes are append-only like issued invoices; a wrong credit note can't be undone in v1.
