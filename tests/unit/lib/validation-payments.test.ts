import { describe, expect, it } from "vitest";

import {
  applyCreditSchema,
  isPaymentErrorKey,
  PAYMENT_ERROR_KEYS,
  PAYMENT_MODES,
  paymentDateProblem,
  paymentListQuerySchema,
  recordPaymentSchema,
  voidPaymentSchema,
} from "@/lib/validation/payments";
import en from "@/messages/en.json";
import { PAYMENT_MODES as STORED_MODES } from "@/server/db/schema/payments";

const base = {
  customerId: "019a0000-0000-7000-8000-000000000001",
  amount: "₹1,250.50",
  paymentDate: "2026-11-06",
  mode: "UPI",
  allocation: { kind: "AUTO" },
};

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("recordPaymentSchema", () => {
  it("parses rupees to paise, trims text and strips anything else (no client totals)", () => {
    const parsed = recordPaymentSchema.parse({
      ...base,
      reference: "  UTR 42 ",
      notes: "",
      balancePaise: "1",
      allocation: {
        kind: "MANUAL",
        items: [
          { invoiceId: "OPENING", amount: "10" },
          { invoiceId: "019a0000-0000-7000-8000-000000000002", amount: "rs 5" },
        ],
      },
    });
    expect(parsed).toEqual({
      customerId: base.customerId,
      amount: 125_050n,
      paymentDate: "2026-11-06",
      mode: "UPI",
      reference: "UTR 42",
      notes: null,
      allocation: {
        kind: "MANUAL",
        items: [
          { invoiceId: "OPENING", amount: 1_000n },
          { invoiceId: "019a0000-0000-7000-8000-000000000002", amount: 500n },
        ],
      },
    });
  });

  it.each([
    [{ amount: "abc" }, "paymentAmountInvalid"],
    [{ amount: "0" }, "paymentAmountPositive"],
    [{ amount: "100000000.01" }, "paymentAmountTooHigh"],
    [{ paymentDate: "2026-02-30" }, "paymentDateInvalid"],
    [{ mode: "GOLD" }, "paymentModeRequired"],
    [{ customerId: "x" }, "customerRequired"],
    [{ reference: "x".repeat(51) }, "textTooLong"],
    [
      { allocation: { kind: "MANUAL", items: [{ invoiceId: "nope", amount: "1" }] } },
      "invoiceNotOpen",
    ],
    [
      {
        allocation: {
          kind: "MANUAL",
          items: [{ invoiceId: "OPENING", amount: "1.234" }],
        },
      },
      "allocationInvalid",
    ],
    [
      {
        allocation: {
          kind: "MANUAL",
          items: Array.from({ length: 101 }, () => ({ invoiceId: "OPENING", amount: "1" })),
        },
      },
      "allocationTooMany",
    ],
  ])("refuses %j with %s", (patch, message) => {
    expect(messages(recordPaymentSchema.safeParse({ ...base, ...patch }))).toContain(message);
  });

  it("allows a walk-in payment (no customer)", () => {
    expect(recordPaymentSchema.parse({ ...base, customerId: null }).customerId).toBeNull();
  });

  it("uses the same modes as the database", () => {
    expect(PAYMENT_MODES).toEqual(STORED_MODES);
  });
});

describe("paymentDateProblem", () => {
  it.each([
    ["2026-11-06", null],
    ["2025-11-06", null],
    ["2026-11-07", "paymentDateFuture"],
    ["2025-11-05", "paymentDateTooOld"],
  ])("%s → %s", (date, expected) => {
    expect(paymentDateProblem(date, "2026-11-06")).toBe(expected);
  });
});

describe("other payment schemas", () => {
  it("void needs a reason of 3 to 200 characters", () => {
    expect(voidPaymentSchema.parse({ reason: " Cheque bounced " }).reason).toBe("Cheque bounced");
    expect(messages(voidPaymentSchema.safeParse({ reason: "x" }))).toEqual(["voidReasonRequired"]);
    expect(messages(voidPaymentSchema.safeParse({ reason: "x".repeat(201) }))).toEqual([
      "textTooLong",
    ]);
  });

  it("apply credit takes an allocation", () => {
    expect(applyCreditSchema.parse({ allocation: { kind: "AUTO" } })).toEqual({
      allocation: { kind: "AUTO" },
    });
  });

  it("list filters fall back to no filter", () => {
    expect(paymentListQuerySchema.parse({ customer: "x", from: "bad", cursor: "c" })).toEqual({
      customer: undefined,
      from: undefined,
      to: undefined,
      cursor: "c",
    });
  });

  it("knows its error keys", () => {
    expect(isPaymentErrorKey("paymentAlreadyVoided")).toBe(true);
    expect(isPaymentErrorKey("nope")).toBe(false);
    expect(Object.keys(en.payments.errors).sort()).toEqual([...PAYMENT_ERROR_KEYS].sort());
  });
});
