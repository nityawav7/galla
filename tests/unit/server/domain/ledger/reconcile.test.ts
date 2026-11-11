import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { addDays } from "@/server/domain/fy";
import { balancePaise, settledStatus } from "@/server/domain/invoice/status";
import { ageReceivables } from "@/server/domain/ledger/aging";
import { customerCredit } from "@/server/domain/ledger/customer-credit";
import { buildLedger } from "@/server/domain/ledger/ledger";
import {
  autoAllocate,
  type CreditSource,
  type OpenItem,
  pairWithSources,
} from "@/server/domain/payment/allocation";

/*
 * The whole Phase 8 model on random data (SPEC F7 AC): a customer with an opening balance gets
 * invoices, payments split oldest first, credit notes and "Apply advance". However it goes, the
 * ledger balance is opening + invoices − payments − credit notes, the aging adds up to it, and
 * nothing is ever paid beyond its balance.
 */

const START = "2026-04-01";

interface Invoice {
  id: string;
  date: string;
  dueDate: string;
  grand: bigint;
  paid: bigint;
  credited: bigint;
}

type Op =
  | { kind: "invoice"; grand: bigint; day: number; creditDays: number }
  | { kind: "pay"; amount: bigint; day: number }
  | { kind: "credit"; pick: number; part: number; day: number }
  | { kind: "apply" };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("invoice" as const),
    grand: fc.bigInt({ min: 1n, max: 500_000n }),
    day: fc.integer({ min: 0, max: 200 }),
    creditDays: fc.integer({ min: 0, max: 60 }),
  }),
  fc.record({
    kind: fc.constant("pay" as const),
    amount: fc.bigInt({ min: 1n, max: 800_000n }),
    day: fc.integer({ min: 0, max: 200 }),
  }),
  fc.record({
    kind: fc.constant("credit" as const),
    pick: fc.nat(),
    part: fc.integer({ min: 1, max: 100 }),
    day: fc.integer({ min: 0, max: 200 }),
  }),
  fc.constant({ kind: "apply" as const }),
);

function run(opening: bigint, ops: readonly Op[]) {
  const invoices: Invoice[] = [];
  const payments: { id: string; date: string; amount: bigint; unallocated: bigint }[] = [];
  const creditNotes: { id: string; date: string; amount: bigint }[] = [];
  let appliedTo = 0n;
  let appliedFrom = 0n;

  const credit = () =>
    customerCredit({
      openingBalancePaise: opening,
      appliedToOpeningPaise: appliedTo,
      appliedFromOpeningPaise: appliedFrom,
      unallocatedPaise: payments.reduce((sum, p) => sum + p.unallocated, 0n),
    });
  const openItems = (): OpenItem[] => [
    { invoiceId: null, invoiceDate: null, number: null, balancePaise: credit().openingOwedPaise },
    ...invoices.map((inv) => ({
      invoiceId: inv.id,
      invoiceDate: inv.date,
      number: inv.id,
      balancePaise: balancePaise({
        grandTotalPaise: inv.grand,
        amountPaidPaise: inv.paid,
        amountCreditedPaise: inv.credited,
      }),
    })),
  ];
  const apply = (invoiceId: string | null, amount: bigint) => {
    if (invoiceId === null) appliedTo += amount;
    else {
      const invoice = invoices.find((inv) => inv.id === invoiceId);
      if (!invoice) throw new Error("no invoice");
      invoice.paid += amount;
    }
  };

  ops.forEach((step, index) => {
    const id = String(index).padStart(4, "0");
    if (step.kind === "invoice") {
      const date = addDays(START, step.day);
      invoices.push({
        id,
        date,
        dueDate: addDays(date, step.creditDays),
        grand: step.grand,
        paid: 0n,
        credited: 0n,
      });
    } else if (step.kind === "pay") {
      const { allocations, onAccountPaise } = autoAllocate(step.amount, openItems());
      allocations.forEach((a) => {
        apply(a.invoiceId, a.amountPaise);
      });
      payments.push({
        id,
        date: addDays(START, step.day),
        amount: step.amount,
        unallocated: onAccountPaise,
      });
    } else if (step.kind === "credit") {
      const invoice = invoices[step.pick % Math.max(invoices.length, 1)];
      if (!invoice) return;
      const balance = invoice.grand - invoice.paid - invoice.credited;
      const amount = (balance * BigInt(step.part)) / 100n;
      if (amount === 0n) return;
      invoice.credited += amount;
      creditNotes.push({ id, date: addDays(START, step.day), amount });
    } else {
      const sources: CreditSource[] = [
        { paymentId: null, availablePaise: credit().advanceLeftPaise },
        ...payments.map((p) => ({ paymentId: p.id, availablePaise: p.unallocated })),
      ];
      // An opening advance and an opening balance owed never exist together (one signed number).
      const total = sources.reduce((sum, s) => sum + s.availablePaise, 0n);
      const { allocations } = autoAllocate(total, openItems());
      for (const pair of pairWithSources(sources, allocations)) {
        apply(pair.invoiceId, pair.amountPaise);
        if (pair.paymentId === null) appliedFrom += pair.amountPaise;
        else {
          const payment = payments.find((p) => p.id === pair.paymentId);
          if (payment) payment.unallocated -= pair.amountPaise;
        }
      }
    }
  });
  return { invoices, payments, creditNotes, credit: credit() };
}

describe("ledger, allocation and aging together (SPEC F7 AC)", () => {
  it("ledger balance = opening + invoices − payments − credit notes, and aging adds up to it", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -300_000n, max: 300_000n }),
        fc.array(op, { maxLength: 25 }),
        (opening, ops) => {
          const { invoices, payments, creditNotes, credit } = run(opening, ops);
          const ledger = buildLedger({
            openingBalancePaise: opening,
            openingDate: START,
            invoices: invoices.map((inv) => ({
              id: inv.id,
              number: inv.id,
              date: inv.date,
              grandTotalPaise: inv.grand,
            })),
            creditNotes: creditNotes.map((cn) => ({
              id: cn.id,
              number: cn.id,
              date: cn.date,
              grandTotalPaise: cn.amount,
            })),
            payments: payments.map((p) => ({ id: p.id, date: p.date, amountPaise: p.amount })),
          });
          const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);
          expect(ledger.closingPaise).toBe(
            opening +
              sum(invoices.map((inv) => inv.grand)) -
              sum(payments.map((p) => p.amount)) -
              sum(creditNotes.map((cn) => cn.amount)),
          );

          for (const inv of invoices) {
            const money = {
              grandTotalPaise: inv.grand,
              amountPaidPaise: inv.paid,
              amountCreditedPaise: inv.credited,
            };
            expect(balancePaise(money) >= 0n).toBe(true);
            expect(["ISSUED", "PARTIALLY_PAID", "PAID"]).toContain(settledStatus(money));
          }

          const aging = ageReceivables(
            {
              openInvoices: invoices.map((inv) => ({
                invoiceDate: inv.date,
                dueDate: inv.dueDate,
                balancePaise: inv.grand - inv.paid - inv.credited,
              })),
              openingOwedPaise: credit.openingOwedPaise,
              onAccountPaise: credit.onAccountPaise,
              today: addDays(START, 230),
            },
            [30, 60, 90],
          );
          expect(aging.totalPaise).toBe(ledger.closingPaise);
        },
      ),
      { numRuns: 300 },
    );
  });
});
