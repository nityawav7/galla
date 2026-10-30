import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { amountInWords } from "@/server/domain/amount-in-words";
import { computeInvoice, type LineAmounts } from "@/server/domain/gst/calc";
import {
  determinePlaceOfSupply,
  documentTypeFor,
  type GstScheme,
} from "@/server/domain/gst/place-of-supply";
import { formatRupees, parseRupees } from "@/server/domain/money";
import { parseQuantity } from "@/server/domain/quantity";

/**
 * Hand-computed invoices (worked in docs/golden-fixtures.md). Amounts are rupee
 * strings so they can be checked against a calculator without converting units.
 */
interface GoldenFixture {
  id: string;
  title: string;
  business: { stateCode: string; scheme: GstScheme };
  customer: { billingStateCode: string | null; shippingStateCode: string | null };
  overrideStateCode: string | null;
  roundOff: boolean;
  lines: {
    description: string;
    qty: string;
    unitPrice: string;
    rateBp: number;
    priceIncludesTax: boolean;
    discount: string;
  }[];
  expected: {
    documentType: string;
    placeOfSupply: string;
    taxMode: string;
    lines: Record<"gross" | "taxable" | "cgst" | "sgst" | "utgst" | "igst" | "total", string>[];
    totals: Record<
      | "gross"
      | "discount"
      | "taxable"
      | "cgst"
      | "sgst"
      | "utgst"
      | "igst"
      | "subTotal"
      | "roundOff"
      | "grandTotal",
      string
    >;
    amountInWords: string;
  };
}

const FIXTURE_DIR = join(import.meta.dirname, "../../../fixtures/invoices");

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as GoldenFixture);

function lineInRupees(line: LineAmounts) {
  return {
    gross: formatRupees(line.grossPaise),
    taxable: formatRupees(line.taxablePaise),
    cgst: formatRupees(line.cgstPaise),
    sgst: formatRupees(line.sgstPaise),
    utgst: formatRupees(line.utgstPaise),
    igst: formatRupees(line.igstPaise),
    total: formatRupees(line.totalPaise),
  };
}

describe("golden invoices", () => {
  it("has the 10 hand-checked fixtures", () => {
    expect(fixtures).toHaveLength(10);
  });

  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))("%s", (_id, fixture) => {
    const place = determinePlaceOfSupply({
      businessStateCode: fixture.business.stateCode,
      scheme: fixture.business.scheme,
      customerBillingStateCode: fixture.customer.billingStateCode,
      customerShippingStateCode: fixture.customer.shippingStateCode,
      overrideStateCode: fixture.overrideStateCode,
    });
    const { lines, totals } = computeInvoice({
      taxMode: place.taxMode,
      roundOff: fixture.roundOff,
      lines: fixture.lines.map((line) => ({
        qtyMilli: parseQuantity(line.qty),
        unitPricePaise: parseRupees(line.unitPrice),
        rateBp: line.rateBp,
        priceIncludesTax: line.priceIncludesTax,
        discountPaise: parseRupees(line.discount),
      })),
    });

    expect(documentTypeFor(fixture.business.scheme)).toBe(fixture.expected.documentType);
    expect(place.stateCode).toBe(fixture.expected.placeOfSupply);
    expect(place.taxMode).toBe(fixture.expected.taxMode);
    expect(lines.map(lineInRupees)).toEqual(fixture.expected.lines);
    expect({
      gross: formatRupees(totals.grossPaise),
      discount: formatRupees(totals.discountPaise),
      taxable: formatRupees(totals.taxablePaise),
      cgst: formatRupees(totals.cgstPaise),
      sgst: formatRupees(totals.sgstPaise),
      utgst: formatRupees(totals.utgstPaise),
      igst: formatRupees(totals.igstPaise),
      subTotal: formatRupees(totals.subTotalPaise),
      roundOff: formatRupees(totals.roundOffPaise),
      grandTotal: formatRupees(totals.grandTotalPaise),
    }).toEqual(fixture.expected.totals);
    expect(amountInWords(totals.grandTotalPaise)).toBe(fixture.expected.amountInWords);
  });
});
