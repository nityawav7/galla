import { describe, expect, it } from "vitest";

import {
  checkIssuable,
  type IssueRulesInput,
  unacknowledged,
} from "@/server/domain/invoice/issue-rules";

const THRESHOLD = 5_000_000n; // ₹50,000

const walkIn = { customerId: null, name: "", gstin: null, addressLine1: null, stateCode: null };
const registered = {
  customerId: "c1",
  name: "Mehta Traders",
  gstin: "27AAPFU0939F1ZV",
  addressLine1: "12 MG Road",
  stateCode: "27",
};

function input(overrides: Partial<IssueRulesInput> = {}): IssueRulesInput {
  return {
    documentType: "TAX_INVOICE",
    recipient: walkIn,
    lines: [{ hsnSac: null }],
    hsnDigitsRequired: 4,
    grandTotalPaise: 10_000n,
    recipientDetailsThresholdPaise: THRESHOLD,
    placeOfSupplyWarnings: [],
    ...overrides,
  };
}

describe("checkIssuable", () => {
  it("passes a small walk-in sale without HSN under the 4-digit setting", () => {
    expect(checkIssuable(input())).toEqual({ errors: [], warnings: [] });
  });

  it("refuses an invoice with no lines", () => {
    expect(checkIssuable(input({ lines: [] })).errors).toEqual([
      { path: "lines", message: "invoiceLinesRequired" },
    ]);
  });

  describe("HSN digits", () => {
    it("needs HSN on every B2B line with the 4-digit setting", () => {
      const result = checkIssuable(
        input({ recipient: registered, lines: [{ hsnSac: "2523" }, { hsnSac: null }] }),
      );
      expect(result.errors).toEqual([{ path: "lines.1.hsnSac", message: "hsnRequired" }]);
    });

    it("needs at least 6 digits on every line with the 6-digit setting, B2C too", () => {
      const result = checkIssuable(
        input({
          hsnDigitsRequired: 6,
          lines: [
            { hsnSac: "252329" },
            { hsnSac: "2523" },
            { hsnSac: "25232900" },
            { hsnSac: null },
          ],
        }),
      );
      expect(result.errors).toEqual([
        { path: "lines.1.hsnSac", message: "hsnSixDigitsRequired" },
        { path: "lines.3.hsnSac", message: "hsnSixDigitsRequired" },
      ]);
    });

    it("applies to a bill of supply", () => {
      const result = checkIssuable(
        input({ documentType: "BILL_OF_SUPPLY", recipient: registered, lines: [{ hsnSac: null }] }),
      );
      expect(result.errors).toHaveLength(1);
    });

    it("never applies to a plain invoice from an unregistered business", () => {
      const result = checkIssuable(
        input({ documentType: "INVOICE", recipient: registered, hsnDigitsRequired: 6 }),
      );
      expect(result.errors).toEqual([]);
    });
  });

  describe("Rule 46 recipient details for unregistered buyers", () => {
    it("refuses a walk-in sale at the threshold", () => {
      expect(checkIssuable(input({ grandTotalPaise: THRESHOLD })).errors).toEqual([
        { path: "customerId", message: "recipientDetailsRequired" },
      ]);
    });

    it("allows a walk-in sale just under it", () => {
      expect(checkIssuable(input({ grandTotalPaise: THRESHOLD - 1n })).errors).toEqual([]);
    });

    it.each([
      ["name", { name: "  " }],
      ["address", { addressLine1: null }],
      ["state", { stateCode: null }],
    ])("refuses a customer with no %s", (_field, missing) => {
      const recipient = { ...registered, gstin: null, ...missing };
      expect(checkIssuable(input({ recipient, grandTotalPaise: THRESHOLD })).errors).toHaveLength(
        1,
      );
    });

    it("allows a named customer with address and state", () => {
      const recipient = { ...registered, gstin: null };
      expect(checkIssuable(input({ recipient, grandTotalPaise: THRESHOLD })).errors).toEqual([]);
    });

    it("does not apply to registered buyers or plain invoices", () => {
      const big = { grandTotalPaise: THRESHOLD * 10n };
      expect(
        checkIssuable(input({ ...big, recipient: { ...walkIn, gstin: "27AAPFU0939F1ZV" } })).errors,
      ).toEqual([{ path: "lines.0.hsnSac", message: "hsnRequired" }]);
      expect(checkIssuable(input({ ...big, documentType: "INVOICE" })).errors).toEqual([]);
    });
  });

  it("passes place-of-supply warnings through", () => {
    const result = checkIssuable(
      input({ documentType: "INVOICE", placeOfSupplyWarnings: ["UNREGISTERED_INTER_STATE"] }),
    );
    expect(result).toEqual({ errors: [], warnings: ["UNREGISTERED_INTER_STATE"] });
  });
});

describe("unacknowledged", () => {
  it("lists the warnings not ticked yet", () => {
    expect(unacknowledged(["UNREGISTERED_INTER_STATE"], [])).toEqual(["UNREGISTERED_INTER_STATE"]);
    expect(unacknowledged(["UNREGISTERED_INTER_STATE"], ["UNREGISTERED_INTER_STATE"])).toEqual([]);
  });
});
