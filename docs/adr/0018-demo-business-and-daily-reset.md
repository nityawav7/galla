# ADR 0018: The demo business, built by replaying the real services every morning

- **Status:** Accepted
- **Date:** 2026-11-13

## Context

SPEC F12 asks for a shared demo business that portfolio visitors can try without signing up: about 60 products, 120 customers and six months of realistic invoices, payments and credit notes, reset every day to the same starting point.

The hard part is making that data _correct_. An invoice's totals, tax split, number, due date, status and allocations come from a lot of rules (GST engine, gapless numbering, oldest-first allocation, credit notes by returned quantity, counter refunds). Writing the rows directly would mean re-implementing all of them, and the demo could then show numbers the app itself would never produce.

Issued invoices, credit notes, payments and refunds are protected by triggers that refuse deletes (ADR 0006, 0010, 0011), so a reset also needs a way to empty the demo without weakening that protection for real shops.

## Decision

- **A plan, then a replay.** `src/server/demo/plan.ts` turns a seed and today's date into a list of events: "invoice for customer 12, these lines", "customer 30 pays half of what they owe", "one unit of line 2 of invoice 81 comes back". It is pure and deterministic: the same seed and day give the same plan. `src/server/jobs/demo-reset.ts` replays the events through the real services (`createDraft`, `issueInvoice`, `recordPayment`, `cancelInvoice`, `createCreditNote`) as the demo owner or staff. So every total, number, allocation, status and audit row is exactly what the app makes.
- **Replaying the past:** `atTime(moment, work)` in `src/server/clock.ts` runs work as if it were that moment (AsyncLocalStorage). Only that work sees the moved clock; every other request reads the real time. Each event happens at its own minute of its own shop day (from 10:00 IST, closed Sundays).
- **Dates move with the reset:** the six months end yesterday, so the demo never goes stale ("all overdue"). Customers and products stay the same; the invoices shift with the calendar.
- **The shop:** _Sharma Hardware & Sanitary_, a fictional store in Pune (`src/server/demo/catalog.ts`).
  - **Products:** 60 everyday items, all at 18%, a rate well established for these HSN headings. Items whose rate wasn't certain after September 2025 (LED lamps) were left out.
  - **Customers:** 40 businesses with fictional, checksum-valid GSTINs (PANs start with `ZZ`), 10 of them in other states for IGST; and 80 retail customers on credit.
  - **No phone numbers or emails anywhere**, so the demo can never message a real person.
  - **No UPI ID**, so a demo invoice can't collect money.
  - Names come from `@faker-js/faker`'s Indian locale, seeded.
- **Size:** about 550 invoices over 6 months, about 500 payments, about 15 credit notes, a few cancellations. The full reset takes about 37 s locally. The cron route allows Vercel's 300 s, which covers Neon's slower free compute.
- **Emptying the demo:** migration `0012_demo_reset` lets the delete guards allow a DELETE only when **both** hold:
  - the transaction ran `SET LOCAL galla.demo_reset = 'on'`;
  - the row's business has `is_demo = true`.

  `wipeDemoBusiness` sets the flag only after locking the business row and checking it is a demo. A real business can't be emptied whatever a transaction sets (tested), and updates stay guarded as before.

- **Two demo users,** "Demo Owner" and "Demo Staff" (`@galla.invalid`, which can't receive mail), are the only members. The reset removes anyone else added and puts the business settings back.
- **Daily at 04:00 IST:** `/api/cron/demo-reset` (Vercel Cron, `CRON_SECRET`), before the 09:00 daily job, which skips demo businesses anyway. Locally: `pnpm db:seed:demo` (refuses Neon).

## Consequences

- The demo is only as correct as the app, by construction; a bug fixed in a service fixes the demo at the next reset.
- During the reset (under a minute) the demo is partly built; at 04:00 IST nobody should notice. A visitor's changes are gone the next morning.
- Visitors share one demo, so they see each other's changes. Phase 12b added the sign-in and guard rails: no settings, members or account changes; "sample" marks; stricter limits (see SPEC F12). The reset also writes the demo users' password hashes, so run it once after rotating `BETTER_AUTH_SECRET`.
- Tests replay the full six months twice (about 75 s of the integration suite).
