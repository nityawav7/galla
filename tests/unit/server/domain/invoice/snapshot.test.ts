import { describe, expect, it } from "vitest";

import {
  type BusinessFields,
  type CustomerFields,
  customerSnapshot,
  supplierSnapshot,
  walkInSnapshot,
} from "@/server/domain/invoice/snapshot";

const customer: CustomerFields = {
  name: "Mehta Traders",
  gstin: "27AAPFU0939F1ZV",
  phoneE164: "+919876543210",
  email: "mehta@example.com",
  billingAddressLine1: "12 MG Road",
  billingAddressLine2: null,
  billingCity: "Pune",
  billingPincode: "411001",
  billingStateCode: "27",
  shippingAddressLine1: null,
  shippingAddressLine2: null,
  shippingCity: null,
  shippingPincode: null,
  shippingStateCode: null,
};

describe("customerSnapshot", () => {
  it("copies the customer and leaves out an empty shipping address", () => {
    expect(customerSnapshot(customer)).toEqual({
      name: "Mehta Traders",
      gstin: "27AAPFU0939F1ZV",
      phoneE164: "+919876543210",
      email: "mehta@example.com",
      billing: {
        line1: "12 MG Road",
        line2: null,
        city: "Pune",
        pincode: "411001",
        stateCode: "27",
      },
      shipping: null,
    });
  });

  it("keeps a shipping address that only has a state", () => {
    expect(customerSnapshot({ ...customer, shippingStateCode: "29" }).shipping).toEqual({
      line1: null,
      line2: null,
      city: null,
      pincode: null,
      stateCode: "29",
    });
  });
});

describe("walkInSnapshot", () => {
  it("has only the trimmed name", () => {
    expect(walkInSnapshot("  Ravi ")).toEqual({
      name: "Ravi",
      gstin: null,
      phoneE164: null,
      email: null,
      billing: null,
      shipping: null,
    });
  });
});

describe("supplierSnapshot", () => {
  it("copies the business as printed on the invoice", () => {
    const business: BusinessFields = {
      legalName: "Sharma Hardware LLP",
      tradeName: "Sharma Hardware",
      gstin: "27AAPFU0939F1ZV",
      gstScheme: "REGULAR",
      stateCode: "27",
      addressLine1: "4 Station Road",
      addressLine2: null,
      city: "Nashik",
      pincode: "422001",
      phoneE164: null,
      email: null,
      logoUrl: null,
      signatureUrl: null,
    };
    expect(supplierSnapshot(business)).toEqual({
      legalName: "Sharma Hardware LLP",
      tradeName: "Sharma Hardware",
      gstin: "27AAPFU0939F1ZV",
      gstScheme: "REGULAR",
      stateCode: "27",
      address: {
        line1: "4 Station Road",
        line2: null,
        city: "Nashik",
        pincode: "422001",
        stateCode: "27",
      },
      phoneE164: null,
      email: null,
      logoUrl: null,
      signatureUrl: null,
    });
  });
});
