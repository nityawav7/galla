# ADR 0010: Payments, allocation and the udhaar ledger

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

Phase 8 (SPEC F7, §4.9) records money received. A payment can pay several invoices, part of one, or nothing yet ("on account"); SPEC forbids paying an invoice beyond its balance. The customer ledger must equal opening balance + invoices − payments − credit notes, and aging must show what is overdue. Customers also carry a signed opening balance from before Galla (positive = they owe, negative = an advance). Money is the shop's most sensitive data, so wrong totals must be impossible, not just unlikely.

## Decision

- **Allocation rows.** `payments` holds the money received; `payment_allocations` holds how much of it went where. What isn't allocated is on account. An invoice's `amount_paid_paise` is a cached sum of its allocations, and its stored status follows the money (`settledStatus`: nothing paid → `ISSUED`, part → `PARTIALLY_PAID`, all → `PAID`).
- **The opening balance is an end of an allocation** (Phase 8 plan, decision 3): a null `invoice_id` pays the opening balance owed, a null `payment_id` is money from an opening advance. Invoices paid from an advance show as paid, and aging is exact. Once used, the opening balance can't be lowered below what was applied (customer.service checks it under the customer lock).
- **Oldest first** (decision 2): the opening balance owed, then invoices by invoice date and number. "Apply advance" uses the opening advance first, then payments oldest first. The pure functions live in `src/server/domain/payment/allocation.ts`.
- **On-account money moves only when someone applies it** (decision 5). Issuing an invoice never takes it.
- **Payments are never edited or deleted** (decision 6). The owner voids one with a reason (`payment:void`); its allocations stay for history but stop counting, and each invoice it paid goes back to the status its money now gives. A trigger refuses any other change and every delete.
- **One lock order:** customer → payment → invoices (by id). Payments, voids, "Apply advance", credit notes and opening-balance edits on the same customer run one after the other and can't deadlock. The open invoices are locked with `FOR UPDATE`, so one cancelled meanwhile is re-checked and left out.
- **The database checks the money at commit.** A deferred constraint trigger (migration `0009`) checks every payment and invoice a transaction touched: no live payment has more allocated than its amount, and every invoice's amount paid equals its live allocations. A CHECK keeps the stored status in step with paid and credited amounts.
- **Balances are computed, not cached** (decision 15): the ledger and the customer list sum invoices, credit notes and live payments with indexes on `(business_id, customer_id, date)`. Phase 9's 10k-invoice performance test decides whether a cache is needed.
- **Aging** (decision 8): "not due yet" plus 0–30, 31–60, 61–90 and 90+ days past due (0 = due today; no due date = due on the invoice date). The opening balance still owed and money on account sit beside the buckets, so they add up to the ledger balance. Bucket limits are config (`AGING_LIMITS`).

## Consequences

- The ledger, aging and invoice statuses can't disagree: a fast-check property test runs random invoices, payments, credit notes, voids and "Apply advance" through the real services and checks ledger = opening + invoices − payments − credit notes, aging total = ledger, and every status = `settledStatus`.
- A payment entered wrongly is voided and recorded again; there is no edit screen.
- Voided payments and cancelled invoices are left out of the ledger (decisions 6 and 7); they stay visible in their own lists.
- A credit note was capped at the invoice's balance here; [ADR 0011](0011-credit-notes-on-paid-invoices-and-refunds.md) lifts that and adds refunds.
- Galla records money only: no receipt vouchers, and no GST on advances (CA question 8).
