/**
 * What a printed invoice or credit note shows (SPEC §4.7 Rule 46 fields), as display strings.
 * The A4 and 80 mm PDF templates both read this one model, so they can't disagree, and the
 * model is unit-tested without rendering a PDF. Labels stay in the message files; this module
 * only formats values. Everything comes from the document's snapshots, never live records.
 */

import { amountInWords } from "../amount-in-words";
import { formatIndianDate } from "../fy";
import { type DocumentType } from "../gst/place-of-supply";
import { formatINR } from "../money";
import { formatIndianPhone } from "../phone";
import { formatQuantity } from "../quantity";
import { findState } from "../states";
import { type AddressSnapshot, type CustomerSnapshot, type SupplierSnapshot } from "./snapshot";
import { type TaxedLine, taxSummaryByRate } from "./tax-summary";

export type TaxKind = "cgst" | "sgst" | "utgst" | "igst";

export interface PrintableLineInput extends TaxedLine {
  description: string;
  hsnSac: string | null;
  unit: string;
  qtyMilli: bigint;
  unitPricePaise: bigint;
  discountPaise: bigint;
  lineTotalPaise: bigint;
}

export interface PrintableTotalsInput {
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
  roundOffPaise: bigint;
  grandTotalPaise: bigint;
}

export interface PrintableInput {
  type: DocumentType;
  number: string;
  /** ISO dates. */
  date: string;
  dueDate: string | null;
  placeOfSupplyStateCode: string;
  isInterState: boolean;
  supplier: SupplierSnapshot;
  /** Null only for documents issued before snapshots existed; treated as a walk-in. */
  recipient: CustomerSnapshot | null;
  lines: readonly PrintableLineInput[];
  totals: PrintableTotalsInput;
  notes: string | null;
}

export interface PrintableParty {
  /** Null for a walk-in buyer with no name (the template prints "Walk-in customer"). */
  name: string | null;
  /** The legal name when a different trade name is printed above it. */
  legalName: string | null;
  address: string[];
  gstin: string | null;
  phone: string | null;
}

export interface PrintableTax {
  rate: string;
  amount: string;
}

export interface PrintableLine {
  position: number;
  description: string;
  hsnSac: string | null;
  qty: string;
  unit: string;
  unitPrice: string;
  discount: string;
  /** False when the line has no discount, so the slip can leave the figure out. */
  hasDiscount: boolean;
  taxable: string;
  /** One entry per tax kind of the document, in `taxKinds` order. */
  taxes: PrintableTax[];
  total: string;
}

export interface PrintableRate {
  rate: string;
  taxable: string;
  taxes: PrintableTax[];
}

export interface PrintableTotal {
  key: "taxable" | TaxKind | "roundOff";
  amount: string;
}

export interface PrintableDocument {
  type: DocumentType;
  number: string;
  date: string;
  dueDate: string | null;
  placeOfSupply: string;
  /** Only a tax invoice prints tax columns (a Bill of Supply and a plain Invoice carry none). */
  showTax: boolean;
  taxKinds: TaxKind[];
  supplier: PrintableParty;
  recipient: PrintableParty;
  shipTo: string[] | null;
  lines: PrintableLine[];
  rates: PrintableRate[];
  totals: PrintableTotal[];
  grandTotal: string;
  amountInWords: string;
  notes: string | null;
  terms: string | null;
}

/** "Karnataka (29)"; an unknown code is printed as it is. */
function stateLabel(code: string): string {
  const state = findState(code);
  return state ? `${state.name} (${state.code})` : code;
}

function addressLines(address: AddressSnapshot | null): string[] {
  if (!address) return [];
  const cityLine = [address.city, address.pincode].filter(Boolean).join(" ");
  const state = address.stateCode ? stateLabel(address.stateCode) : null;
  return [address.line1, address.line2, cityLine, state].filter((part): part is string =>
    Boolean(part),
  );
}

/** Basis points as a percentage: 1800 → "18%", 25 → "0.25%". Display only, never money. */
export function formatRate(rateBp: number): string {
  return `${String(rateBp / 100)}%`;
}

/** The taxes this document charges: IGST, or CGST with SGST or UTGST (SPEC §4.2). */
export function taxKindsFor(input: {
  type: DocumentType;
  isInterState: boolean;
  placeOfSupplyStateCode: string;
}): TaxKind[] {
  if (input.type !== "TAX_INVOICE") return [];
  if (input.isInterState) return ["igst"];
  const ut = findState(input.placeOfSupplyStateCode)?.isUtWithoutLegislature === true;
  return ut ? ["cgst", "utgst"] : ["cgst", "sgst"];
}

type TaxAmounts = Pick<TaxedLine, "cgstPaise" | "sgstPaise" | "utgstPaise" | "igstPaise">;

const AMOUNT_OF: Record<TaxKind, (amounts: TaxAmounts) => bigint> = {
  cgst: (amounts) => amounts.cgstPaise,
  sgst: (amounts) => amounts.sgstPaise,
  utgst: (amounts) => amounts.utgstPaise,
  igst: (amounts) => amounts.igstPaise,
};

function taxes(kinds: readonly TaxKind[], line: TaxedLine): PrintableTax[] {
  // CGST and SGST/UTGST are each half the rate; IGST is the whole rate.
  return kinds.map((kind) => ({
    rate: formatRate(kind === "igst" ? line.rateBp : line.rateBp / 2),
    amount: formatINR(AMOUNT_OF[kind](line)),
  }));
}

export function supplierParty(supplier: SupplierSnapshot): PrintableParty {
  return {
    name: supplier.tradeName ?? supplier.legalName,
    legalName: supplier.tradeName ? supplier.legalName : null,
    address: addressLines(supplier.address),
    gstin: supplier.gstin,
    phone: supplier.phoneE164 ? formatIndianPhone(supplier.phoneE164) : null,
  };
}

export function recipientParty(recipient: CustomerSnapshot | null): PrintableParty {
  return {
    name: recipient && recipient.name.length > 0 ? recipient.name : null,
    legalName: null,
    address: addressLines(recipient?.billing ?? null),
    gstin: recipient?.gstin ?? null,
    phone: recipient?.phoneE164 ? formatIndianPhone(recipient.phoneE164) : null,
  };
}

export function printableDocument(input: PrintableInput): PrintableDocument {
  const taxKinds = taxKindsFor(input);
  const { totals } = input;
  const totalRows: PrintableTotal[] = [
    { key: "taxable", amount: formatINR(totals.taxablePaise) },
    ...taxKinds.map((kind) => ({ key: kind, amount: formatINR(AMOUNT_OF[kind](totals)) })),
  ];
  if (totals.roundOffPaise !== 0n) {
    totalRows.push({ key: "roundOff", amount: formatINR(totals.roundOffPaise) });
  }
  const shipping = input.recipient?.shipping ?? null;
  return {
    type: input.type,
    number: input.number,
    date: formatIndianDate(input.date),
    dueDate: input.dueDate ? formatIndianDate(input.dueDate) : null,
    placeOfSupply: stateLabel(input.placeOfSupplyStateCode),
    showTax: taxKinds.length > 0,
    taxKinds,
    supplier: supplierParty(input.supplier),
    recipient: recipientParty(input.recipient),
    shipTo: shipping ? addressLines(shipping) : null,
    lines: input.lines.map((line, index) => ({
      position: index + 1,
      description: line.description,
      hsnSac: line.hsnSac,
      qty: formatQuantity(line.qtyMilli),
      unit: line.unit,
      unitPrice: formatINR(line.unitPricePaise),
      discount: formatINR(line.discountPaise),
      hasDiscount: line.discountPaise > 0n,
      taxable: formatINR(line.taxablePaise),
      taxes: taxes(taxKinds, line),
      total: formatINR(line.lineTotalPaise),
    })),
    rates:
      taxKinds.length > 0
        ? taxSummaryByRate(input.lines).map((row) => ({
            rate: formatRate(row.rateBp),
            taxable: formatINR(row.taxablePaise),
            taxes: taxes(taxKinds, row),
          }))
        : [],
    totals: totalRows,
    grandTotal: formatINR(totals.grandTotalPaise),
    amountInWords: amountInWords(totals.grandTotalPaise),
    notes: input.notes,
    terms: input.supplier.terms ?? null,
  };
}
