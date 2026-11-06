import { describe, expect, it } from "vitest";

import {
  draftSchema,
  EMPTY_DRAFT,
  invoiceListQuerySchema,
  issueLineSchema,
  issueSchema,
  MAX_INVOICE_LINES,
} from "@/lib/validation/invoices";

const options = { units: ["NOS", "KGS"], rateBps: [0, 500, 1800] };

const line = {
  productId: null,
  description: "Rice",
  hsnSac: "1006",
  unit: "kgs",
  qty: "1.5",
  unitPrice: "₹64.50",
  discount: "",
  rateBp: 500,
  priceIncludesTax: false,
};

describe("draftSchema", () => {
  it("fills an empty draft", () => {
    expect(EMPTY_DRAFT).toEqual({
      customerId: null,
      walkInName: "",
      placeOfSupplyOverride: null,
      dueDate: null,
      notes: "",
      lines: [],
    });
  });

  it("drops totals and other unknown keys sent by a client", () => {
    const parsed = draftSchema.parse({
      grandTotal: "1.00",
      lines: [{ ...line, lineTotal: "1.00", cgst: "0.01" }],
    });
    expect(parsed).not.toHaveProperty("grandTotal");
    expect(parsed.lines[0]).not.toHaveProperty("lineTotal");
    expect(parsed.lines[0]).not.toHaveProperty("cgst");
  });

  it("keeps half-typed lines but bounds their size", () => {
    expect(draftSchema.parse({ lines: [{ qty: "abc" }] }).lines[0]?.qty).toBe("abc");
    const tooMany = Array.from({ length: MAX_INVOICE_LINES + 1 }, () => ({}));
    expect(draftSchema.safeParse({ lines: tooMany }).error?.issues[0]?.message).toBe(
      "invoiceTooManyLines",
    );
    expect(draftSchema.safeParse({ notes: "x".repeat(501) }).error?.issues[0]?.message).toBe(
      "textTooLong",
    );
    expect(draftSchema.safeParse({ dueDate: "2026-02-30" }).error?.issues[0]?.message).toBe(
      "dueDateInvalid",
    );
    expect(
      draftSchema.safeParse({ placeOfSupplyOverride: "Maharashtra" }).error?.issues[0]?.message,
    ).toBe("stateRequired");
  });
});

describe("issueLineSchema", () => {
  const schema = issueLineSchema(options);
  const messages = (input: unknown) =>
    schema.safeParse(input).error?.issues.map((issue) => [issue.path.join("."), issue.message]);

  it("turns a valid line into paise and milli-units", () => {
    expect(schema.parse(line)).toEqual({
      productId: null,
      description: "Rice",
      hsnSac: "1006",
      unit: "KGS",
      qtyMilli: 1500n,
      unitPricePaise: 6450n,
      discountPaise: 0n,
      rateBp: 500,
      priceIncludesTax: false,
    });
    expect(schema.parse({ ...line, hsnSac: "", discount: "10.5" })).toMatchObject({
      hsnSac: null,
      discountPaise: 1050n,
    });
  });

  it.each([
    [{ description: " " }, "description", "lineDescriptionRequired"],
    [{ unit: "BAG" }, "unit", "unitRequired"],
    [{ qty: "1.2345" }, "qty", "qtyInvalid"],
    [{ qty: "0" }, "qty", "qtyPositive"],
    [{ qty: "1000001" }, "qty", "qtyTooHigh"],
    [{ unitPrice: "-5" }, "unitPrice", "priceInvalid"],
    [{ discount: "abc" }, "discount", "discountInvalid"],
    [{ rateBp: 1200 }, "rateBp", "rateRequired"],
    [{ hsnSac: "12" }, "hsnSac", "hsnInvalid"],
  ])("refuses %o", (patch, path, message) => {
    expect(messages({ ...line, ...patch })).toEqual([[path, message]]);
  });
});

describe("issueSchema", () => {
  it("defaults to no acknowledged warnings and refuses unknown ones", () => {
    expect(issueSchema.parse({ version: 1 })).toEqual({ version: 1, acknowledgedWarnings: [] });
    expect(issueSchema.safeParse({ version: 1, acknowledgedWarnings: ["NOPE"] }).success).toBe(
      false,
    );
  });
});

describe("invoiceListQuerySchema", () => {
  it("keeps good filters and drops bad ones", () => {
    expect(
      invoiceListQuerySchema.parse({
        status: "OVERDUE",
        from: "2026-11-01",
        to: "nope",
        customer: "x",
        q: "  ",
      }),
    ).toEqual({ status: "OVERDUE", from: "2026-11-01" });
  });
});
