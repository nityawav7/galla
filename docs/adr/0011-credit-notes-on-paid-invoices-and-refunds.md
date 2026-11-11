# ADR 0011: Credit notes on paid invoices, and refunds

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Until now a credit note was capped at the invoice's balance (ADR 0010), so a shop couldn't credit goods returned after the customer had paid: the owner had to void the payment, issue the note and record the payment again. And money a customer had on account could only pay later bills, never be given back. Phase 8 plan decisions 12 and 13 (approved) allow both.

## Decision

- **A credit note is capped at what is not yet credited**, not at the balance. Returned quantities already guarantee it; the service checks the total again for the round-off.
- **What was paid beyond the invoice's new total is released** from the invoice's allocations: newest payment first, the opening advance last (`releaseAllocations` in `src/server/domain/payment/release.ts`, property-tested: exactly the excess, never more than a row holds). An allocation shrinks, or goes when it reaches zero. The money becomes that payment's unallocated part, so it is the customer's money on account. The invoice's paid and credited amounts and status change in one statement.
- **A walk-in sale has no account**, so a credit note that releases money on a paid walk-in invoice must say how it was given back (`refund: { mode, reference }`). The refund is written in the same transaction, linked to the credit note, and can't be voided.
- **Refunds** (`refunds` table, migration `0010`): the owner (`payment:void`) pays back money on account, never more than there is (checked under the customer lock). Like payments, they are never edited or deleted, only voided once, and a trigger refuses anything else. The ledger shows a refund as a debit; balances, the statement and the customer list include it.
- **The database checks the customer's money at commit.** A deferred constraint trigger keeps the opening advance left + unallocated live payments − live refunds at zero or more after any change to refunds, payments (voids), allocations or the opening balance.
- **Voiding a payment whose money was refunded is refused** ("void the refund first"), and the opening advance can't be lowered below what was refunded from it.
- **Lock order is unchanged:** customer → payment → invoices. A credit note locks the customer, then the invoice, and only then reads and releases its allocations.

## Consequences

- A paid invoice can be credited directly; its status stays `PAID` until everything is credited back (then `ISSUED`, shown as `CREDITED`, with nothing paid).
- Customer money is now opening advance + unallocated payments − refunds, everywhere it is read (`customerCredit` takes `refundedPaise`).
- A walk-in's counter refund is final; a wrong one is fixed with the shop's own books, not in Galla.
- No GST change: the credit note is the same document either way; only where the money sits moves (CA question 9 stays open in `docs/golden-fixtures.md`).
