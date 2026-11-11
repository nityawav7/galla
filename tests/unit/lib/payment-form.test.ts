import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  defaultPaymentValues,
  paymentFormIssues,
  type PaymentFormValues,
  paymentPreview,
  rupees,
  toFormPath,
  toPaymentInput,
} from "@/lib/payment-form";
import { type PaymentFormOptions } from "@/lib/payment-view";

const A = "019a0000-0000-7000-8000-00000000000a";
const B = "019a0000-0000-7000-8000-00000000000b";

const customerOptions: PaymentFormOptions = {
  customer: { id: "019a0000-0000-7000-8000-000000000001", name: "Mehta Traders" },
  invoiceId: B,
  openItems: [
    { key: "OPENING", number: null, invoiceDate: null, dueDate: null, balancePaise: "5000" },
    {
      key: A,
      number: "INV/26-27/0001",
      invoiceDate: "2026-11-01",
      dueDate: "2026-11-01",
      balancePaise: "10000",
    },
    {
      key: B,
      number: "INV/26-27/0002",
      invoiceDate: "2026-11-02",
      dueDate: "2026-11-02",
      balancePaise: "20050",
    },
  ],
  onAccountPaise: "0",
  today: "2026-11-06",
};

const walkInOptions: PaymentFormOptions = {
  customer: null,
  invoiceId: A,
  openItems: [
    {
      key: A,
      number: "INV/26-27/0001",
      invoiceDate: "2026-11-06",
      dueDate: null,
      balancePaise: "25000",
    },
  ],
  onAccountPaise: "0",
  today: "2026-11-06",
};

function values(overrides: Partial<PaymentFormValues> = {}, options = customerOptions) {
  return { ...defaultPaymentValues(options), ...overrides };
}

describe("rupees", () => {
  it.each([
    [0n, "0"],
    [50_000n, "500"],
    [20_050n, "200.50"],
    [7n, "0.07"],
  ])("%s paise → %s", (paise, text) => {
    expect(rupees(paise)).toBe(text);
  });
});

describe("defaultPaymentValues", () => {
  it("from an invoice: its balance, cash, today, that invoice first", () => {
    expect(defaultPaymentValues(customerOptions)).toEqual({
      amount: "200.50",
      paymentDate: "2026-11-06",
      mode: "CASH",
      reference: "",
      notes: "",
      allocationChoice: "INVOICE",
      manual: [{ amount: "" }, { amount: "" }, { amount: "" }],
    });
  });

  it("from a customer: no amount, oldest first", () => {
    expect(defaultPaymentValues({ ...customerOptions, invoiceId: null })).toMatchObject({
      amount: "",
      allocationChoice: "AUTO",
    });
  });
});

describe("toPaymentInput and paymentPreview", () => {
  it("pays the invoice first, up to its balance; the rest is on account", () => {
    const form = values({ amount: "300" });
    expect(toPaymentInput(form, customerOptions).allocation).toEqual({
      kind: "MANUAL",
      items: [{ invoiceId: B, amount: "200.50" }],
    });
    expect(paymentPreview(form, customerOptions)).toEqual({
      allocations: [{ invoiceId: B, amountPaise: 20_050n }],
      onAccountPaise: 9_950n,
    });
    expect(toPaymentInput(values({ amount: "abc" }), customerOptions).allocation).toEqual({
      kind: "MANUAL",
      items: [],
    });
  });

  it("oldest first starts with the opening balance", () => {
    const form = values({ amount: "120", allocationChoice: "AUTO" });
    expect(toPaymentInput(form, customerOptions).allocation).toEqual({ kind: "AUTO" });
    expect(paymentPreview(form, customerOptions)).toEqual({
      allocations: [
        { invoiceId: null, amountPaise: 5_000n },
        { invoiceId: A, amountPaise: 7_000n },
      ],
      onAccountPaise: 0n,
    });
  });

  it("chosen amounts leave out empty rows and keep the opening balance key", () => {
    const form = values({
      amount: "150",
      allocationChoice: "MANUAL",
      manual: [{ amount: "10" }, { amount: " " }, { amount: "100" }],
    });
    expect(toPaymentInput(form, customerOptions).allocation).toEqual({
      kind: "MANUAL",
      items: [
        { invoiceId: "OPENING", amount: "10" },
        { invoiceId: B, amount: "100" },
      ],
    });
    expect(paymentPreview(form, customerOptions)).toEqual({
      allocations: [
        { invoiceId: null, amountPaise: 1_000n },
        { invoiceId: B, amountPaise: 10_000n },
      ],
      onAccountPaise: 4_000n,
    });
  });

  it("gives nothing to preview until the amounts are numbers", () => {
    expect(paymentPreview(values({ amount: "" }), customerOptions)).toBeNull();
    expect(paymentPreview(values({ amount: "0" }), customerOptions)).toBeNull();
    expect(
      paymentPreview(
        values({
          amount: "10",
          allocationChoice: "MANUAL",
          manual: [{ amount: "x" }, { amount: "" }, { amount: "" }],
        }),
        customerOptions,
      ),
    ).toBeNull();
  });

  it("returns the domain's error when the chosen amounts don't fit", () => {
    const preview = paymentPreview(
      values({
        amount: "10",
        allocationChoice: "MANUAL",
        manual: [{ amount: "" }, { amount: "100.01" }, { amount: "" }],
      }),
      customerOptions,
    );
    expect(preview).toBeInstanceOf(ValidationError);
  });

  it("a walk-in payment goes wholly to its invoice", () => {
    const form = values({ amount: "250" }, walkInOptions);
    expect(form.allocationChoice).toBe("AUTO");
    expect(toPaymentInput(form, walkInOptions)).toMatchObject({
      customerId: null,
      allocation: { kind: "MANUAL", items: [{ invoiceId: A, amount: "250" }] },
    });
    expect(toPaymentInput(form, { ...walkInOptions, invoiceId: null }).allocation).toEqual({
      kind: "MANUAL",
      items: [],
    });
  });
});

describe("paymentFormIssues", () => {
  it("is empty for a good form", () => {
    expect(paymentFormIssues(values({ amount: "100" }), customerOptions)).toEqual([]);
  });

  it("maps schema problems to form fields", () => {
    expect(
      paymentFormIssues(values({ amount: "", mode: "GOLD" as "CASH" }), customerOptions)
        .map((issue) => issue.message)
        .sort(),
    ).toEqual(["paymentAmountInvalid", "paymentModeRequired"]);
  });

  it("checks the date against today", () => {
    expect(
      paymentFormIssues(values({ amount: "1", paymentDate: "2026-11-07" }), customerOptions),
    ).toEqual([{ path: "paymentDate", message: "paymentDateFuture" }]);
  });

  it("puts allocation problems on the row that caused them", () => {
    expect(
      paymentFormIssues(
        values({
          amount: "500",
          allocationChoice: "MANUAL",
          manual: [{ amount: "" }, { amount: "" }, { amount: "300" }],
        }),
        customerOptions,
      ),
    ).toEqual([{ path: "manual.2.amount", message: "allocationExceedsBalance" }]);
    expect(
      paymentFormIssues(
        values({
          amount: "5",
          allocationChoice: "MANUAL",
          manual: [{ amount: "" }, { amount: "10" }, { amount: "" }],
        }),
        customerOptions,
      ),
    ).toEqual([{ path: "root.allocation", message: "allocationExceedsPayment" }]);
  });

  it("refuses more than a walk-in invoice's balance", () => {
    expect(paymentFormIssues(values({ amount: "250.01" }, walkInOptions), walkInOptions)).toEqual([
      { path: "amount", message: "allocationExceedsBalance" },
    ]);
  });
});

describe("toFormPath", () => {
  const manual = values({
    allocationChoice: "MANUAL",
    manual: [{ amount: "" }, { amount: "5" }, { amount: "" }],
  });
  it.each([
    ["allocation.items.0.amount", manual, "manual.1.amount"],
    ["allocation.items.5.amount", manual, "root.allocation"],
    ["allocation.items.0.invoiceId", values(), "amount"],
    ["allocation.amount", manual, "root.allocation"],
    ["paymentDate", manual, "paymentDate"],
  ])("%s → %s", (path, form, expected) => {
    expect(toFormPath(path, form)).toBe(expected);
  });
});
