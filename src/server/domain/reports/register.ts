/*
 * The sales register (SPEC F8, decision 11 of the Phase 9 plan): every invoice and credit note in
 * a period, by date. Cancelled invoices stay listed at zero so the number series has no holes;
 * credit notes are negative rows against their invoice. Totals count only what is live.
 */

export interface DocumentAmounts {
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
  roundOffPaise: bigint;
  totalPaise: bigint;
}

export interface RegisterInvoice extends DocumentAmounts {
  date: string;
  number: string;
  status: "ISSUED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
  /** Null or empty for a walk-in sale. */
  customer: string | null;
  gstin: string | null;
  /** State code. */
  placeOfSupply: string;
  paidPaise: bigint;
  creditedPaise: bigint;
}

export interface RegisterNote extends DocumentAmounts {
  date: string;
  number: string;
  invoiceNumber: string;
  customer: string | null;
  gstin: string | null;
  placeOfSupply: string;
}

export interface RegisterRow extends DocumentAmounts {
  kind: "INVOICE" | "CREDIT_NOTE";
  date: string;
  number: string;
  /** The invoice a credit note reduces. */
  against: string | null;
  customer: string | null;
  gstin: string | null;
  placeOfSupply: string;
  status: RegisterInvoice["status"] | "CREDIT_NOTE";
  paidPaise: bigint;
  creditedPaise: bigint;
  balancePaise: bigint;
}

export interface RegisterTotals extends DocumentAmounts {
  invoices: number;
  cancelled: number;
  creditNotes: number;
}

function times(amounts: DocumentAmounts, by: bigint): DocumentAmounts {
  return {
    taxablePaise: amounts.taxablePaise * by,
    cgstPaise: amounts.cgstPaise * by,
    sgstPaise: amounts.sgstPaise * by,
    utgstPaise: amounts.utgstPaise * by,
    igstPaise: amounts.igstPaise * by,
    roundOffPaise: amounts.roundOffPaise * by,
    totalPaise: amounts.totalPaise * by,
  };
}

function plus(a: DocumentAmounts, b: DocumentAmounts): DocumentAmounts {
  return {
    taxablePaise: a.taxablePaise + b.taxablePaise,
    cgstPaise: a.cgstPaise + b.cgstPaise,
    sgstPaise: a.sgstPaise + b.sgstPaise,
    utgstPaise: a.utgstPaise + b.utgstPaise,
    igstPaise: a.igstPaise + b.igstPaise,
    roundOffPaise: a.roundOffPaise + b.roundOffPaise,
    totalPaise: a.totalPaise + b.totalPaise,
  };
}

const NOTHING = times(
  {
    taxablePaise: 0n,
    cgstPaise: 0n,
    sgstPaise: 0n,
    utgstPaise: 0n,
    igstPaise: 0n,
    roundOffPaise: 0n,
    totalPaise: 0n,
  },
  1n,
);

function invoiceRow(invoice: RegisterInvoice): RegisterRow {
  const live = invoice.status !== "CANCELLED";
  return {
    kind: "INVOICE",
    date: invoice.date,
    number: invoice.number,
    against: null,
    customer: invoice.customer,
    gstin: invoice.gstin,
    placeOfSupply: invoice.placeOfSupply,
    status: invoice.status,
    ...times(invoice, live ? 1n : 0n),
    paidPaise: live ? invoice.paidPaise : 0n,
    creditedPaise: live ? invoice.creditedPaise : 0n,
    balancePaise: live ? invoice.totalPaise - invoice.paidPaise - invoice.creditedPaise : 0n,
  };
}

function noteRow(note: RegisterNote): RegisterRow {
  return {
    kind: "CREDIT_NOTE",
    date: note.date,
    number: note.number,
    against: note.invoiceNumber,
    customer: note.customer,
    gstin: note.gstin,
    placeOfSupply: note.placeOfSupply,
    status: "CREDIT_NOTE",
    ...times(note, -1n),
    paidPaise: 0n,
    creditedPaise: 0n,
    balancePaise: 0n,
  };
}

export function salesRegister(
  invoices: readonly RegisterInvoice[],
  notes: readonly RegisterNote[],
): { rows: RegisterRow[]; totals: RegisterTotals } {
  const rows = [...invoices.map(invoiceRow), ...notes.map(noteRow)].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(a.kind === "CREDIT_NOTE") - Number(b.kind === "CREDIT_NOTE") ||
      a.number.localeCompare(b.number, "en"),
  );
  return {
    rows,
    totals: {
      invoices: invoices.length,
      cancelled: invoices.filter((invoice) => invoice.status === "CANCELLED").length,
      creditNotes: notes.length,
      ...rows.reduce<DocumentAmounts>((sum, row) => plus(sum, row), NOTHING),
    },
  };
}
