import { describe, expect, it } from "vitest";

import {
  type BusinessFormValues,
  businessSchema,
  EMPTY_BUSINESS_FORM,
} from "@/lib/validation/business";

const valid: BusinessFormValues = {
  ...EMPTY_BUSINESS_FORM,
  legalName: "Sharma Hardware Pvt Ltd",
  tradeName: "Sharma Hardware",
  addressLine1: "12 Station Road",
  city: "Pune",
  pincode: "411001",
  stateCode: "27",
  gstScheme: "REGULAR",
  gstin: "27AAPFU0939F1ZV",
};

const issues = (values: BusinessFormValues) => {
  const result = businessSchema.safeParse(values);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`);
};

describe("businessSchema", () => {
  it("normalizes and turns empty optional fields into null", () => {
    expect(
      businessSchema.parse({
        ...valid,
        legalName: "  Sharma Hardware Pvt Ltd ",
        gstin: " 27aapfu0939f1zv ",
        phone: "98765 43210",
        email: " Ramesh@Example.COM ",
        upiVpa: " Ramesh@OKSBI ",
        addressLine2: "  ",
      }),
    ).toMatchObject({
      legalName: "Sharma Hardware Pvt Ltd",
      gstin: "27AAPFU0939F1ZV",
      phone: "+919876543210",
      email: "ramesh@example.com",
      upiVpa: "ramesh@oksbi",
      addressLine2: null,
    });
  });

  it("accepts a minimal unregistered shop and drops any GSTIN typed earlier", () => {
    const result = businessSchema.parse({
      ...valid,
      tradeName: "",
      gstScheme: "UNREGISTERED",
      gstin: "27AAPFU0939F1ZV",
    });
    expect(result).toMatchObject({ gstScheme: "UNREGISTERED", gstin: null, tradeName: null });
  });

  it.each([
    [{ legalName: "" }, "legalName:legalNameRequired"],
    [{ legalName: "x".repeat(101) }, "legalName:textTooLong"],
    [{ addressLine1: "" }, "addressLine1:addressRequired"],
    [{ city: "" }, "city:cityRequired"],
    [{ pincode: "01100" }, "pincode:pincodeInvalid"],
    [{ pincode: "011001" }, "pincode:pincodeInvalid"],
    [{ stateCode: "" }, "stateCode:stateRequired"],
    [{ stateCode: "25" }, "stateCode:stateRequired"], // inactive legacy code
    [{ phone: "12345" }, "phone:phoneInvalid"],
    [{ email: "not-an-email" }, "email:emailInvalid"],
    [{ invoicePrefix: "" }, "invoicePrefix:prefixInvalid"],
    [{ invoicePrefix: "TOOLONG" }, "invoicePrefix:prefixInvalid"],
    [{ invoicePrefix: "IN/V" }, "invoicePrefix:prefixInvalid"],
    [{ invoicePrefix: "cn" }, "invoicePrefix:prefixesSame"],
    [{ upiVpa: "ramesh" }, "upiVpa:upiInvalid"],
  ] as const)("rejects %o with %s", (change, expected) => {
    expect(issues({ ...valid, ...change })).toEqual([expected]);
  });

  describe("GSTIN rules (SPEC §4.1)", () => {
    it.each(["REGULAR", "COMPOSITION"] as const)("requires a GSTIN for %s", (gstScheme) => {
      expect(issues({ ...valid, gstScheme, gstin: "" })).toEqual(["gstin:gstinRequired"]);
    });

    it.each([
      ["27AAPFU0939F1Z", "gstin:gstinFormat"],
      ["99AAPFU0939F1ZV", "gstin:gstinState"],
      ["27AAPFU0939F1ZW", "gstin:gstinChecksum"],
    ])("rejects %s with %s", (gstin, expected) => {
      expect(issues({ ...valid, gstin })).toEqual([expected]);
    });

    it("requires the GSTIN's state to match the business state", () => {
      expect(issues({ ...valid, stateCode: "29" })).toEqual(["gstin:gstinStateMismatch"]);
    });
  });
});
