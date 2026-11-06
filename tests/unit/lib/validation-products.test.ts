import { describe, expect, it } from "vitest";

import { listQuerySchema } from "@/lib/validation/list-query";
import {
  EMPTY_PRODUCT_FORM,
  PRODUCT_CSV_TEMPLATE,
  PRODUCT_FIELD_COLUMNS,
  productRowToForm,
  productSchema,
  type ProductFormValues,
} from "@/lib/validation/products";

const OPTIONS = { units: ["NOS", "BAG", "KGS", "LTR"], rateBps: [0, 500, 1800] };
const schema = productSchema(OPTIONS);

const valid: ProductFormValues = {
  ...EMPTY_PRODUCT_FORM,
  name: " Cement 50 kg ",
  hsnSac: "2523",
  unit: "bag",
  price: "420",
  rateBp: "1800",
  sku: "CEM-50",
};

function errorsFor(values: Partial<ProductFormValues>): Record<string, string> {
  const result = schema.safeParse({ ...valid, ...values });
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("productSchema", () => {
  it("normalises a valid product into what the service stores", () => {
    expect(schema.parse(valid)).toEqual({
      name: "Cement 50 kg",
      hsnSac: "2523",
      unit: "BAG",
      pricePaise: 42000n,
      rateBp: 1800,
      priceIncludesTax: false,
      sku: "CEM-50",
    });
  });

  it("turns empty optional fields into null", () => {
    expect(schema.parse({ ...valid, hsnSac: " ", sku: "" })).toMatchObject({
      hsnSac: null,
      sku: null,
    });
  });

  it.each([
    ["₹1,250.50", 125050n],
    ["Rs. 99", 9900n],
    ["rs 0.5", 50n],
    ["0", 0n],
  ])("reads the price %j", (price, pricePaise) => {
    expect(schema.parse({ ...valid, price }).pricePaise).toBe(pricePaise);
  });

  it.each([
    [{ name: "  " }, "name", "productNameRequired"],
    [{ name: "x".repeat(121) }, "name", "textTooLong"],
    [{ hsnSac: "25A3" }, "hsnSac", "hsnInvalid"],
    [{ hsnSac: "25" }, "hsnSac", "hsnInvalid"],
    [{ hsnSac: "401" }, "hsnSac", "hsnLeadingZero"],
    [{ hsnSac: "123456789" }, "hsnSac", "hsnInvalid"],
    [{ unit: "XYZ" }, "unit", "unitRequired"],
    [{ price: "" }, "price", "priceInvalid"],
    [{ price: "-5" }, "price", "priceInvalid"],
    [{ price: "1.234" }, "price", "priceInvalid"],
    [{ price: "1000000001" }, "price", "priceTooHigh"],
    [{ rateBp: "1200" }, "rateBp", "rateRequired"],
    [{ rateBp: "18%" }, "rateBp", "rateRequired"],
    [{ sku: "CEM 50" }, "sku", "skuInvalid"],
    [{ priceIncludesTax: "maybe" }, "priceIncludesTax", "yesNoInvalid"],
  ] as const)("rejects %j", (values, path, message) => {
    expect(errorsFor(values)).toEqual({ [path]: message });
  });

  it.each(["0401", "252310", "25231000"])("accepts the HSN %s", (hsnSac) => {
    expect(schema.parse({ ...valid, hsnSac }).hsnSac).toBe(hsnSac);
  });

  it.each([
    [true, true],
    ["yes", true],
    ["Y", true],
    ["1", true],
    ["हाँ", true],
    ["no", false],
    ["", false],
    ["FALSE", false],
  ] as const)("reads price includes tax %j as %s", (priceIncludesTax, expected) => {
    expect(schema.parse({ ...valid, priceIncludesTax }).priceIncludesTax).toBe(expected);
  });
});

describe("productRowToForm", () => {
  const row = {
    name: "Milk",
    hsn_sac: "0401",
    unit: "ltr",
    price: "56.50",
    gst_rate: "0%",
    price_includes_tax: "yes",
    sku: "",
  };

  it("maps CSV columns to form values, converting the rate to basis points", () => {
    expect(schema.parse(productRowToForm(row))).toEqual({
      name: "Milk",
      hsnSac: "0401",
      unit: "LTR",
      pricePaise: 5650n,
      rateBp: 0,
      priceIncludesTax: true,
      sku: null,
    });
  });

  it("keeps an unreadable rate as typed so the schema reports it", () => {
    expect(productRowToForm({ ...row, gst_rate: "GST" }).rateBp).toBe("GST");
    expect(schema.safeParse(productRowToForm({ ...row, gst_rate: "GST" })).success).toBe(false);
  });

  it("maps every form field to a CSV column", () => {
    expect(Object.keys(PRODUCT_FIELD_COLUMNS).sort()).toEqual(Object.keys(valid).sort());
  });

  it("accepts the template's example rows", () => {
    const [header, ...examples] = PRODUCT_CSV_TEMPLATE;
    for (const example of examples) {
      const values = Object.fromEntries(
        header?.map((column, i) => [column, example[i] ?? ""]) ?? [],
      );
      expect(schema.safeParse(productRowToForm(values as typeof row)).success).toBe(true);
    }
  });
});

describe("listQuerySchema", () => {
  it("reads search, cursor and the archived flag", () => {
    expect(listQuerySchema.parse({ q: " cement ", cursor: "abc", archived: "1" })).toEqual({
      q: "cement",
      cursor: "abc",
      archived: true,
    });
  });

  it("falls back to defaults for missing or odd values", () => {
    expect(listQuerySchema.parse({})).toEqual({ q: undefined, cursor: undefined, archived: false });
    expect(listQuerySchema.parse({ q: ["a", "b"], cursor: 5, archived: "yes" })).toEqual({
      q: undefined,
      cursor: undefined,
      archived: false,
    });
    expect(listQuerySchema.parse({ q: "   " }).q).toBeUndefined();
  });
});
