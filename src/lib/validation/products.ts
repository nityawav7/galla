import { z } from "zod";

import { parseScaled } from "@/server/domain/decimal";
import { parseRatePercent } from "@/server/domain/tax-rate";

import { requiredText, text, yesNo } from "./fields";

/**
 * Products (SPEC F2), shared by the product form, the CSV import and product.service.
 * Units and GST rates are data (CLAUDE.md rule 12), so the schema is built from the lists the
 * page or service loaded from the reference tables.
 */

export interface CatalogOptions {
  /** UQC codes from `units`. */
  units: readonly string[];
  /** Rates (basis points) a product may use: the active ones, plus its current one on edit. */
  rateBps: readonly number[];
}

/** ₹10 crore per unit: far above any shop price, and keeps line maths well inside bigint. */
export const MAX_PRICE_PAISE = 10n ** 11n;

const HSN = /^[0-9]{4}([0-9]{2}){0,2}$/;
/** 3, 5 or 7 digits: usually Excel dropped the leading zero of a chapter 01–09 code. */
const HSN_MISSING_ZERO = /^[0-9]{3}([0-9]{2}){0,2}$/;
const SKU = /^[A-Za-z0-9._/-]+$/;
const CURRENCY_PREFIX = /^(₹|rs\.?)\s*/i;

const hsnSac = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (!value || HSN.test(value)) return;
    ctx.addIssue({
      code: "custom",
      message: HSN_MISSING_ZERO.test(value) ? "hsnLeadingZero" : "hsnInvalid",
    });
  })
  .transform((value) => value || null);

const price = z
  .string()
  .trim()
  .transform((value) => value.replace(CURRENCY_PREFIX, ""))
  .transform((value, ctx) => {
    const paise = parseScaled(value, 2);
    if (paise === null) {
      ctx.addIssue({ code: "custom", message: "priceInvalid" });
      return z.NEVER;
    }
    if (paise > MAX_PRICE_PAISE) {
      ctx.addIssue({ code: "custom", message: "priceTooHigh" });
      return z.NEVER;
    }
    return paise;
  });

export function productSchema({ units, rateBps }: CatalogOptions) {
  return z
    .object({
      name: requiredText(120, "productNameRequired"),
      hsnSac,
      unit: z
        .string()
        .trim()
        .toUpperCase()
        .refine((value) => units.includes(value), { error: "unitRequired" }),
      price,
      rateBp: z
        .string()
        .trim()
        .refine((value) => /^[0-9]+$/.test(value) && rateBps.includes(Number(value)), {
          error: "rateRequired",
        })
        .transform(Number),
      priceIncludesTax: yesNo,
      sku: text(40)
        .refine((value) => !value || SKU.test(value), { error: "skuInvalid" })
        .transform((value) => value || null),
    })
    .transform(({ price: pricePaise, ...product }) => ({ ...product, pricePaise }));
}

/** What the form holds. `priceIncludesTax` is a checkbox; a CSV gives "yes"/"no". */
export type ProductFormValues = z.input<ReturnType<typeof productSchema>>;
/** What the service stores. */
export type ProductInput = z.output<ReturnType<typeof productSchema>>;

export const EMPTY_PRODUCT_FORM = {
  name: "",
  hsnSac: "",
  unit: "NOS",
  price: "",
  rateBp: "1800",
  priceIncludesTax: false,
  sku: "",
} satisfies ProductFormValues;

/** Listing filters from the URL (`?q=&cursor=&archived=1`). Bad values fall back to defaults. */
export const listQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value === "" ? undefined : value)),
  cursor: z.string().max(500).optional().catch(undefined),
  archived: z
    .unknown()
    .transform((value) => value === "1" || value === true)
    .catch(false),
});

export type ListQuery = z.output<typeof listQuerySchema>;

// --- CSV import --------------------------------------------------------------------------

export const PRODUCT_CSV_COLUMNS = [
  "name",
  "hsn_sac",
  "unit",
  "price",
  "gst_rate",
  "price_includes_tax",
  "sku",
] as const;

export type ProductCsvColumn = (typeof PRODUCT_CSV_COLUMNS)[number];

export const PRODUCT_CSV_REQUIRED = [
  "name",
  "unit",
  "price",
  "gst_rate",
] as const satisfies readonly ProductCsvColumn[];

/** Where a form field's error shows up in the file. */
export const PRODUCT_FIELD_COLUMNS = {
  name: "name",
  hsnSac: "hsn_sac",
  unit: "unit",
  price: "price",
  rateBp: "gst_rate",
  priceIncludesTax: "price_includes_tax",
  sku: "sku",
} as const satisfies Record<keyof ProductFormValues, ProductCsvColumn>;

/** The downloadable template: the header plus two example rows. */
export const PRODUCT_CSV_TEMPLATE: readonly (readonly string[])[] = [
  PRODUCT_CSV_COLUMNS,
  ["Cement 50 kg bag", "2523", "BAG", "420", "18", "no", "CEM-50"],
  ["Toned milk 1 L", "0401", "LTR", "56.50", "0", "yes", ""],
];

/** A row of the import preview, formatted on the server. */
export interface ImportPreviewRow {
  line: number;
  name: string;
  unit: string;
  price: string;
  rate: string;
  sku: string | null;
}

/** One CSV row, as form values the product schema then checks. */
export function productRowToForm(values: Record<ProductCsvColumn, string>): ProductFormValues {
  const rateBp = parseRatePercent(values.gst_rate);
  return {
    name: values.name,
    hsnSac: values.hsn_sac,
    unit: values.unit,
    price: values.price,
    // An unreadable rate stays as typed, so the schema reports it.
    rateBp: rateBp === null ? values.gst_rate : String(rateBp),
    priceIncludesTax: values.price_includes_tax,
    sku: values.sku,
  };
}
