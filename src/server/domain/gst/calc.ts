/**
 * Line and invoice totals, exactly as SPEC §4.5. The server always recomputes with
 * these functions; the invoice builder runs the same code for live totals.
 *
 * Rates come in as data (basis points) and are never looked up here.
 */

import { type FieldIssue, ValidationError } from "@/lib/errors";

import { divRoundHalfUp, roundToRupee, sumPaise } from "../money";
import { MILLI_PER_UNIT } from "../quantity";
import type { TaxMode } from "./place-of-supply";

const BP_PER_UNIT = 10_000n;
const MAX_RATE_BP = 10_000;

export interface LineInput {
  qtyMilli: bigint;
  unitPricePaise: bigint;
  rateBp: number;
  priceIncludesTax: boolean;
  /** Always applied before tax. */
  discountPaise: bigint;
}

export interface LineAmounts {
  grossPaise: bigint;
  taxableBeforeDiscountPaise: bigint;
  discountPaise: bigint;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
  totalPaise: bigint;
}

export interface InvoiceInput {
  lines: readonly LineInput[];
  taxMode: TaxMode;
  /** Round the grand total to the nearest rupee, shown as a "Round off" line. */
  roundOff: boolean;
}

export interface InvoiceTotals {
  grossPaise: bigint;
  discountPaise: bigint;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
  taxPaise: bigint;
  /** Σ line totals, before round-off. */
  subTotalPaise: bigint;
  roundOffPaise: bigint;
  grandTotalPaise: bigint;
}

export interface InvoiceAmounts {
  lines: LineAmounts[];
  totals: InvoiceTotals;
}

function invalid(issues: FieldIssue[]): ValidationError {
  return new ValidationError("Check the highlighted line values", issues);
}

function validateLineFields(line: LineInput): void {
  const issues: FieldIssue[] = [];
  if (line.qtyMilli <= 0n) {
    issues.push({ path: "qtyMilli", message: "Quantity must be more than 0" });
  }
  if (line.unitPricePaise < 0n) {
    issues.push({ path: "unitPricePaise", message: "Price cannot be negative" });
  }
  if (!Number.isInteger(line.rateBp) || line.rateBp < 0 || line.rateBp > MAX_RATE_BP) {
    issues.push({ path: "rateBp", message: "Choose a valid tax rate" });
  }
  if (line.discountPaise < 0n) {
    issues.push({ path: "discountPaise", message: "Discount cannot be negative" });
  }
  if (issues.length > 0) throw invalid(issues);
}

export function computeLine(line: LineInput, taxMode: TaxMode): LineAmounts {
  validateLineFields(line);
  const rate = BigInt(line.rateBp);

  const grossPaise = divRoundHalfUp(line.qtyMilli * line.unitPricePaise, MILLI_PER_UNIT);
  // Without GST there is no tax inside the price to back out.
  const taxableBeforeDiscountPaise =
    line.priceIncludesTax && taxMode !== "NONE"
      ? divRoundHalfUp(grossPaise * BP_PER_UNIT, BP_PER_UNIT + rate)
      : grossPaise;

  if (line.discountPaise > taxableBeforeDiscountPaise) {
    throw invalid([
      { path: "discountPaise", message: "Discount cannot be more than the line value before tax" },
    ]);
  }
  const taxablePaise = taxableBeforeDiscountPaise - line.discountPaise;

  // Each half is rounded on its own so CGST always equals SGST/UTGST.
  const half = divRoundHalfUp(taxablePaise * rate, 2n * BP_PER_UNIT);
  const cgstPaise = taxMode === "INTRA_SGST" || taxMode === "INTRA_UTGST" ? half : 0n;
  const sgstPaise = taxMode === "INTRA_SGST" ? half : 0n;
  const utgstPaise = taxMode === "INTRA_UTGST" ? half : 0n;
  const igstPaise = taxMode === "INTER" ? divRoundHalfUp(taxablePaise * rate, BP_PER_UNIT) : 0n;

  return {
    grossPaise,
    taxableBeforeDiscountPaise,
    discountPaise: line.discountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    utgstPaise,
    igstPaise,
    totalPaise: taxablePaise + cgstPaise + sgstPaise + utgstPaise + igstPaise,
  };
}

function computeLineAt(line: LineInput, taxMode: TaxMode, index: number): LineAmounts {
  try {
    return computeLine(line, taxMode);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    throw new ValidationError(
      error.message,
      error.issues.map((issue) => ({ ...issue, path: `lines.${String(index)}.${issue.path}` })),
      { cause: error },
    );
  }
}

/** Invoice totals are sums of line values, never recomputed from aggregates. */
export function computeInvoice(input: InvoiceInput): InvoiceAmounts {
  const lines = input.lines.map((line, index) => computeLineAt(line, input.taxMode, index));
  const sum = (pick: (line: LineAmounts) => bigint): bigint => sumPaise(lines.map(pick));

  const cgstPaise = sum((l) => l.cgstPaise);
  const sgstPaise = sum((l) => l.sgstPaise);
  const utgstPaise = sum((l) => l.utgstPaise);
  const igstPaise = sum((l) => l.igstPaise);
  const subTotalPaise = sum((l) => l.totalPaise);
  const roundOffPaise = input.roundOff ? roundToRupee(subTotalPaise) - subTotalPaise : 0n;

  return {
    lines,
    totals: {
      grossPaise: sum((l) => l.grossPaise),
      discountPaise: sum((l) => l.discountPaise),
      taxablePaise: sum((l) => l.taxablePaise),
      cgstPaise,
      sgstPaise,
      utgstPaise,
      igstPaise,
      taxPaise: cgstPaise + sgstPaise + utgstPaise + igstPaise,
      subTotalPaise,
      roundOffPaise,
      grandTotalPaise: subTotalPaise + roundOffPaise,
    },
  };
}
