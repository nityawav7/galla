import { describe, expect, it } from "vitest";

import { type EvaluationInput, evaluateDraft, lineIssues } from "@/lib/invoice-evaluation";
import { draftSchema, type InvoiceDraftValues } from "@/lib/validation/invoices";

const options = { units: ["NOS", "BAG"], rateBps: [0, 500, 1800] };
const business = { stateCode: "27", gstScheme: "REGULAR" as const, roundOffEnabled: true };

const line = {
  description: "PVC pipe",
  hsnSac: "3917",
  unit: "NOS",
  qty: "2",
  unitPrice: "100",
  rateBp: 1800,
};

function input(draft: InvoiceDraftValues, overrides: Partial<EvaluationInput> = {}) {
  return {
    draft: draftSchema.parse(draft),
    business,
    customer: null,
    options,
    invoiceDate: "2026-11-06",
    ...overrides,
  } satisfies EvaluationInput;
}

describe("evaluateDraft", () => {
  it("computes an intra-state walk-in sale", () => {
    const result = evaluateDraft(input({ lines: [line] }));
    expect(result).toMatchObject({
      issues: [],
      taxMode: "INTRA_SGST",
      documentType: "TAX_INVOICE",
      placeOfSupplyStateCode: "27",
      isInterState: false,
      dueDate: null,
      totals: { taxablePaise: 20000n, cgstPaise: 1800n, sgstPaise: 1800n, grandTotalPaise: 23600n },
    });
  });

  it("uses the customer's shipping state and credit days", () => {
    const result = evaluateDraft(
      input(
        { lines: [line] },
        { customer: { billingStateCode: "27", shippingStateCode: "29", creditDays: 30 } },
      ),
    );
    expect(result).toMatchObject({
      taxMode: "INTER",
      placeOfSupplyStateCode: "29",
      isInterState: true,
      dueDate: "2026-12-06",
      totals: { igstPaise: 3600n },
    });
  });

  it("keeps bad lines out of the totals and reports them by field", () => {
    const result = evaluateDraft(
      input({ lines: [line, { ...line, qty: "0" }, { ...line, discount: "500" }] }),
    );
    expect(result.lines.map((evaluated) => evaluated.index)).toEqual([0]);
    expect(result.totals.grandTotalPaise).toBe(23600n);
    expect(lineIssues(result.issues, 1)).toEqual({ qty: "qtyPositive" });
    expect(lineIssues(result.issues, 2)).toEqual({ discount: "discountTooLarge" });
    expect(lineIssues(result.issues, 0)).toEqual({});
  });

  it("takes rate, HSN and unit from the product, not the line", () => {
    const productId = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    const product = { hsnSac: "2523", unit: "BAG", rateBp: 500, priceIncludesTax: false };
    const result = evaluateDraft(
      input(
        { lines: [{ ...line, productId, rateBp: 0 }] },
        { products: new Map([[productId, product]]) },
      ),
    );
    expect(result.lines[0]?.line).toMatchObject({ hsnSac: "2523", unit: "BAG", rateBp: 500 });
  });

  it("charges no GST for a composition business, and blocks another state", () => {
    const composition = { ...business, gstScheme: "COMPOSITION" as const };
    const local = evaluateDraft(input({ lines: [line] }, { business: composition }));
    expect(local).toMatchObject({ taxMode: "NONE", documentType: "BILL_OF_SUPPLY" });
    expect(local.lines[0]?.line).toMatchObject({ rateBp: 0, priceIncludesTax: false });
    expect(local.totals.grandTotalPaise).toBe(20000n);

    const other = evaluateDraft(
      input({ lines: [line], placeOfSupplyOverride: "29" }, { business: composition }),
    );
    expect(other.issues).toEqual([{ path: "placeOfSupply", message: "compositionInterState" }]);
    expect(other).toMatchObject({ placeOfSupply: null, placeOfSupplyStateCode: "27" });
  });

  it("refuses an inactive override state and a due date in the past", () => {
    const result = evaluateDraft(
      input({ lines: [line], placeOfSupplyOverride: "25", dueDate: "2026-11-01" }),
    );
    expect(result.issues).toEqual([
      { path: "placeOfSupplyOverride", message: "placeOfSupplyInvalid" },
      { path: "dueDate", message: "dueDateBeforeInvoiceDate" },
    ]);
    expect(result.dueDate).toBeNull();
  });
});
