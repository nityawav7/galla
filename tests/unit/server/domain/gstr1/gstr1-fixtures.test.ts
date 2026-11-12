import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildGstr1, type Gstr1Invoice } from "@/server/domain/gstr1/build";
import { parseRupees } from "@/server/domain/money";

/*
 * The hand-computed golden invoices (docs/golden-fixtures.md) through the GSTR-1 helper: each one
 * lands in the table its buyer and place of supply call for, with its taxable value per rate
 * exactly as worked by hand. Fixture 07 is a composition dealer, who files no GSTR-1.
 */

interface Fixture {
  id: string;
  business: { scheme: string };
  lines: { rateBp: number }[];
  expected: {
    placeOfSupply: string;
    taxMode: "INTRA" | "INTER";
    lines: Record<"taxable" | "cgst" | "sgst" | "utgst" | "igst", string>[];
    totals: { grandTotal: string };
  };
}

const DIR = join(import.meta.dirname, "../../../../fixtures/invoices");
const fixtures = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(join(DIR, file), "utf8")) as Fixture);

/** Which fixtures bill a registered business (their titles say so); the rest are consumers. */
const REGISTERED = new Set(["02-inter-state-b2b", "11-builder-acceptance"]);

function asInvoice(fixture: Fixture): Gstr1Invoice {
  const registered = REGISTERED.has(fixture.id);
  return {
    number: `INV/26-27/${fixture.id.slice(0, 2)}`,
    date: "2026-11-02",
    cancelled: false,
    recipientGstin: registered ? "29AABCU9603R1ZM" : null,
    recipientName: registered ? "Buyer" : null,
    placeOfSupply: fixture.expected.placeOfSupply,
    interState: fixture.expected.taxMode === "INTER",
    totalPaise: parseRupees(fixture.expected.totals.grandTotal),
    lines: fixture.expected.lines.map((line, index) => ({
      rateBp: fixture.lines[index]?.rateBp ?? -1,
      taxablePaise: parseRupees(line.taxable),
      cgstPaise: parseRupees(line.cgst),
      sgstPaise: parseRupees(line.sgst),
      utgstPaise: parseRupees(line.utgst),
      igstPaise: parseRupees(line.igst),
      hsn: "9999",
      uqc: "NOS-NUMBERS",
      qtyMilli: 1_000n,
    })),
  };
}

function taxableByRate(invoice: Gstr1Invoice): [number, bigint][] {
  const rates = new Map<number, bigint>();
  for (const line of invoice.lines) {
    if (line.rateBp !== 0)
      rates.set(line.rateBp, (rates.get(line.rateBp) ?? 0n) + line.taxablePaise);
  }
  return [...rates.entries()].sort((a, b) => a[0] - b[0]);
}

const filed = fixtures.filter((fixture) => fixture.business.scheme === "REGULAR");

describe("golden invoices in the GSTR-1 helper", () => {
  it("leaves only the composition dealer out", () => {
    expect(fixtures.length - filed.length).toBe(1);
  });

  it.each(filed.map((fixture) => [fixture.id, fixture] as const))("%s", (id, fixture) => {
    const invoice = asInvoice(fixture);
    const report = buildGstr1({ invoices: [invoice], notes: [], b2clThresholdPaise: 10_000_000n });
    const expected = taxableByRate(invoice);
    if (REGISTERED.has(id)) {
      expect(report.b2b.map((row) => [row.rateBp, row.taxablePaise])).toEqual(expected);
      expect(report.b2cs).toEqual([]);
    } else {
      // Every consumer sale here is far below ₹1 lakh: B2CS by place of supply and rate.
      expect(report.b2b).toEqual([]);
      expect(report.b2cl).toEqual([]);
      expect(report.b2cs).toEqual(
        expected.map(([rateBp, taxablePaise]) => ({
          placeOfSupply: fixture.expected.placeOfSupply,
          rateBp,
          taxablePaise,
        })),
      );
    }
    const tax = (rows: typeof report.hsnB2b) =>
      rows.reduce((sum, row) => sum + row.igstPaise + row.cgstPaise + row.sgstPaise, 0n);
    const allTax = invoice.lines.reduce(
      (sum, line) => sum + line.igstPaise + line.cgstPaise + line.sgstPaise + line.utgstPaise,
      0n,
    );
    expect(tax([...report.hsnB2b, ...report.hsnB2c])).toBe(allTax);
  });
});
