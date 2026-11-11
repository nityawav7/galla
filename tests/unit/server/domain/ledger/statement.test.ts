import { describe, expect, it } from "vitest";

import { buildLedger } from "@/server/domain/ledger/ledger";
import { balanceAmount, statementRows } from "@/server/domain/ledger/statement";

describe("balanceAmount", () => {
  it.each([
    [200_200n, { amount: "₹2,002.00", side: "DR" }],
    [-9_800n, { amount: "₹98.00", side: "CR" }],
    [0n, { amount: "₹0.00", side: null }],
  ] as const)("%s paise → %j", (paise, expected) => {
    expect(balanceAmount(paise)).toEqual(expected);
  });
});

describe("statementRows", () => {
  const ledger = buildLedger(
    {
      openingBalancePaise: 150_000n,
      openingDate: "2026-11-01",
      invoices: [
        { id: "i1", number: "SH/26-27/0001", date: "2026-11-02", grandTotalPaise: 80_200n },
      ],
      creditNotes: [
        { id: "c1", number: "CN/26-27/0001", date: "2026-11-03", grandTotalPaise: 47_200n },
      ],
      payments: [
        { id: "p1", date: "2026-11-04", amountPaise: 30_000n },
        { id: "p2", date: "2026-11-05", amountPaise: 155_000n },
      ],
    },
    "2026-11-02",
  );

  it("formats each row with its payment details and a Dr/Cr balance", () => {
    expect(
      statementRows(ledger, {
        p1: { mode: "UPI", reference: "UTR123" },
        p2: { mode: "CASH", reference: null },
      }),
    ).toEqual([
      {
        date: "02-11-2026",
        kind: "INVOICE",
        number: "SH/26-27/0001",
        mode: null,
        reference: null,
        debit: "₹802.00",
        credit: "",
        balance: { amount: "₹2,302.00", side: "DR" },
      },
      {
        date: "03-11-2026",
        kind: "CREDIT_NOTE",
        number: "CN/26-27/0001",
        mode: null,
        reference: null,
        debit: "",
        credit: "₹472.00",
        balance: { amount: "₹1,830.00", side: "DR" },
      },
      {
        date: "04-11-2026",
        kind: "PAYMENT",
        number: null,
        mode: "UPI",
        reference: "UTR123",
        debit: "",
        credit: "₹300.00",
        balance: { amount: "₹1,530.00", side: "DR" },
      },
      {
        date: "05-11-2026",
        kind: "PAYMENT",
        number: null,
        mode: "CASH",
        reference: null,
        debit: "",
        credit: "₹1,550.00",
        balance: { amount: "₹20.00", side: "CR" },
      },
    ]);
  });

  it("a payment without details (never expected) still prints", () => {
    const rows = statementRows(ledger, {});
    expect(rows[2]).toMatchObject({ kind: "PAYMENT", mode: null, reference: null });
  });
});
