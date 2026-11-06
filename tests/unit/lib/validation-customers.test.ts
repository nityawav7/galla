import { describe, expect, it } from "vitest";

import {
  CUSTOMER_CSV_TEMPLATE,
  CUSTOMER_FIELD_COLUMNS,
  customerRowToForm,
  customerSchema,
  type CustomerCsvColumn,
  type CustomerFormValues,
  EMPTY_CUSTOMER_FORM,
  resolveStateInput,
} from "@/lib/validation/customers";

const valid: CustomerFormValues = {
  ...EMPTY_CUSTOMER_FORM,
  name: " Ramesh Traders ",
  phone: "098765 43210",
  email: "Ramesh@Example.com",
  gstin: "29aaaci1681g1zl",
  billingAddressLine1: "4 MG Road",
  billingCity: "Bengaluru",
  billingPincode: "560001",
  billingStateCode: "29",
  openingBalance: "1,500.50",
  creditDays: "15",
};

function errorsFor(values: Partial<CustomerFormValues>): Record<string, string> {
  const result = customerSchema.safeParse({ ...valid, ...values });
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("customerSchema", () => {
  it("normalises a customer into what the service stores", () => {
    expect(customerSchema.parse(valid)).toEqual({
      customer: {
        name: "Ramesh Traders",
        phoneE164: "+919876543210",
        email: "ramesh@example.com",
        gstin: "29AAACI1681G1ZL",
        billingAddressLine1: "4 MG Road",
        billingAddressLine2: null,
        billingCity: "Bengaluru",
        billingPincode: "560001",
        billingStateCode: "29",
        shippingAddressLine1: null,
        shippingAddressLine2: null,
        shippingCity: null,
        shippingPincode: null,
        shippingStateCode: null,
        openingBalancePaise: 150050n,
        creditDays: 15,
      },
      stateOverride: false,
      confirmDuplicatePhone: false,
    });
  });

  it("keeps an unregistered walk-in customer with just a name", () => {
    expect(customerSchema.parse({ ...EMPTY_CUSTOMER_FORM, name: "Walk-in" }).customer).toEqual(
      expect.objectContaining({
        phoneE164: null,
        gstin: null,
        billingStateCode: null,
        openingBalancePaise: 0n,
        creditDays: 0,
      }),
    );
  });

  it("fills the billing state from the GSTIN when none is chosen (SPEC F3)", () => {
    expect(customerSchema.parse({ ...valid, billingStateCode: "" }).customer.billingStateCode).toBe(
      "29",
    );
  });

  it("refuses a state that differs from the GSTIN's unless overridden (SPEC §4.1)", () => {
    expect(errorsFor({ billingStateCode: "27" })).toEqual({
      billingStateCode: "customerStateMismatch",
    });
    const overridden = customerSchema.parse({
      ...valid,
      billingStateCode: "27",
      stateOverride: true,
    });
    expect(overridden.customer.billingStateCode).toBe("27");
    expect(overridden.stateOverride).toBe(true);
  });

  it("stores an advance as a negative opening balance", () => {
    const parsed = customerSchema.parse({
      ...valid,
      balanceType: "ADVANCE",
      openingBalance: "200",
    });
    expect(parsed.customer.openingBalancePaise).toBe(-20000n);
    expect(
      customerSchema.parse({ ...valid, balanceType: "ADVANCE", openingBalance: "" }).customer
        .openingBalancePaise,
    ).toBe(0n);
  });

  it.each([
    [{ name: "" }, "name", "customerNameRequired"],
    [{ phone: "12345" }, "phone", "phoneInvalid"],
    [{ email: "nope" }, "email", "emailInvalid"],
    [{ gstin: "29AAACI1681G1ZM" }, "gstin", "gstinChecksum"],
    [{ gstin: "0717UNO00157UNO" }, "gstin", "gstinUnsupported"],
    [{ billingPincode: "0123" }, "billingPincode", "pincodeInvalid"],
    [{ billingStateCode: "28" }, "billingStateCode", "stateRequired"],
    [{ shippingStateCode: "99" }, "shippingStateCode", "stateRequired"],
    [{ shippingPincode: "12" }, "shippingPincode", "pincodeInvalid"],
    [{ openingBalance: "-5" }, "openingBalance", "balanceInvalid"],
    [{ openingBalance: "1000000001" }, "openingBalance", "balanceInvalid"],
    [{ creditDays: "366" }, "creditDays", "creditDaysInvalid"],
    [{ creditDays: "1.5" }, "creditDays", "creditDaysInvalid"],
  ] as const)("rejects %j", (values, path, message) => {
    expect(errorsFor(values)).toEqual({ [path]: message });
  });

  it("does not compare states when the GSTIN itself is invalid", () => {
    expect(errorsFor({ gstin: "bad", billingStateCode: "27" })).toEqual({ gstin: "gstinFormat" });
  });
});

describe("resolveStateInput", () => {
  it.each([
    ["27", "27"],
    ["7", "07"],
    [" karnataka ", "29"],
    ["Delhi", "07"],
    ["", ""],
    ["Atlantis", "Atlantis"],
    ["Andhra Pradesh (Old)", "Andhra Pradesh (Old)"],
  ])("reads %j as %j", (input, code) => {
    expect(resolveStateInput(input)).toBe(code);
  });
});

describe("customerRowToForm", () => {
  const empty = Object.fromEntries(
    Object.values(CUSTOMER_FIELD_COLUMNS).map((column) => [column, ""]),
  ) as Record<CustomerCsvColumn, string>;

  it("maps CSV columns, reading a signed balance and state names", () => {
    const form = customerRowToForm({
      ...empty,
      name: "Asha",
      phone: "9822222222",
      billing_state: "maharashtra",
      shipping_state: "7",
      opening_balance: "-250",
      credit_days: "",
    });
    expect(customerSchema.parse(form).customer).toMatchObject({
      name: "Asha",
      phoneE164: "+919822222222",
      billingStateCode: "27",
      shippingStateCode: "07",
      openingBalancePaise: -25000n,
      creditDays: 0,
    });
  });

  it("never overrides a GSTIN/state mismatch from a file", () => {
    const form = customerRowToForm({
      ...empty,
      name: "Mismatch",
      gstin: "29AAACI1681G1ZL",
      billing_state: "27",
    });
    expect(customerSchema.safeParse(form).success).toBe(false);
  });

  it("accepts the template's example rows", () => {
    const [header, ...examples] = CUSTOMER_CSV_TEMPLATE;
    for (const example of examples) {
      const values = Object.fromEntries(
        header?.map((column, i) => [column, example[i] ?? ""]) ?? [],
      );
      expect(customerSchema.safeParse(customerRowToForm(values as typeof empty)).success).toBe(
        true,
      );
    }
  });
});
