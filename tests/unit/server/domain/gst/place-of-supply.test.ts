import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { determinePlaceOfSupply, documentTypeFor } from "@/server/domain/gst/place-of-supply";

describe("documentTypeFor", () => {
  it.each([
    ["REGULAR", "TAX_INVOICE"],
    ["COMPOSITION", "BILL_OF_SUPPLY"],
    ["UNREGISTERED", "INVOICE"],
  ] as const)("%s issues %s", (scheme, type) => {
    expect(documentTypeFor(scheme)).toBe(type);
  });
});

describe("determinePlaceOfSupply", () => {
  const maharashtra = { businessStateCode: "27", scheme: "REGULAR" } as const;

  it("same state → CGST + SGST", () => {
    expect(determinePlaceOfSupply({ ...maharashtra, customerBillingStateCode: "27" })).toEqual({
      stateCode: "27",
      isInterState: false,
      taxMode: "INTRA_SGST",
    });
  });

  it("other state → IGST", () => {
    expect(determinePlaceOfSupply({ ...maharashtra, customerBillingStateCode: "29" })).toEqual({
      stateCode: "29",
      isInterState: true,
      taxMode: "INTER",
    });
  });

  it("shipping state wins over billing state", () => {
    const result = determinePlaceOfSupply({
      ...maharashtra,
      customerBillingStateCode: "27",
      customerShippingStateCode: "24",
    });
    expect(result).toMatchObject({ stateCode: "24", taxMode: "INTER" });
  });

  it("customer with no state (walk-in) → the business's own state", () => {
    expect(determinePlaceOfSupply({ ...maharashtra })).toMatchObject({
      stateCode: "27",
      taxMode: "INTRA_SGST",
    });
    expect(
      determinePlaceOfSupply({
        ...maharashtra,
        customerBillingStateCode: null,
        customerShippingStateCode: null,
      }),
    ).toMatchObject({ stateCode: "27" });
  });

  it("override wins over everything", () => {
    const result = determinePlaceOfSupply({
      ...maharashtra,
      customerBillingStateCode: "29",
      customerShippingStateCode: "24",
      overrideStateCode: "27",
    });
    expect(result).toMatchObject({ stateCode: "27", taxMode: "INTRA_SGST" });
  });

  it.each(["04", "26", "31", "35", "38"])("intra-state in UT %s → CGST + UTGST", (code) => {
    expect(
      determinePlaceOfSupply({
        businessStateCode: code,
        scheme: "REGULAR",
        customerBillingStateCode: code,
      }).taxMode,
    ).toBe("INTRA_UTGST");
  });

  it.each(["07", "34", "01"])("intra-state in %s (UT with legislature) → CGST + SGST", (code) => {
    expect(
      determinePlaceOfSupply({
        businessStateCode: code,
        scheme: "REGULAR",
        customerBillingStateCode: code,
      }).taxMode,
    ).toBe("INTRA_SGST");
  });

  it("business in a UT selling to another state → IGST", () => {
    expect(
      determinePlaceOfSupply({
        businessStateCode: "04",
        scheme: "REGULAR",
        customerBillingStateCode: "03",
      }).taxMode,
    ).toBe("INTER");
  });

  it("composition dealer within the state → no tax", () => {
    expect(
      determinePlaceOfSupply({
        businessStateCode: "27",
        scheme: "COMPOSITION",
        customerBillingStateCode: "27",
      }),
    ).toEqual({ stateCode: "27", isInterState: false, taxMode: "NONE" });
  });

  it("composition dealer cannot sell to another state", () => {
    expect(() =>
      determinePlaceOfSupply({
        businessStateCode: "27",
        scheme: "COMPOSITION",
        customerBillingStateCode: "29",
      }),
    ).toThrow(ValidationError);
  });

  it("unregistered business → no tax in either case", () => {
    for (const customerState of ["27", "29"]) {
      expect(
        determinePlaceOfSupply({
          businessStateCode: "27",
          scheme: "UNREGISTERED",
          customerBillingStateCode: customerState,
        }).taxMode,
      ).toBe("NONE");
    }
  });

  it.each([
    { businessStateCode: "99" },
    { businessStateCode: "28" },
    { customerBillingStateCode: "00" },
    { customerShippingStateCode: "25" },
    { overrideStateCode: "98" },
  ])("rejects unknown or inactive state codes %j", (codes) => {
    expect(() => determinePlaceOfSupply({ ...maharashtra, ...codes })).toThrow(ValidationError);
  });
});
