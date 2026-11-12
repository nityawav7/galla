/*
 * The GSTR-1 helper (SPEC §4.10, decisions 12–17 of the Phase 9 plan, ADR 0013): a period's
 * invoices and credit notes sorted into the tables of the GST offline tool. Pure: amounts stay in
 * paise and rates in basis points; the workbook formats them. It is a helper for the CA, not a
 * filed return; the assumptions below are open CA questions 10–14 in docs/golden-fixtures.md.
 *
 * - B2B: a recipient with a GSTIN, one row per invoice per rate.
 * - B2CL: no GSTIN, inter-state, invoice value strictly above the threshold (₹1 lakh, config).
 * - B2CS: every other sale without a GSTIN, summed by place of supply and rate; credit notes on
 *   such sales reduce it (CA question 11).
 * - CDNR: credit notes to a GSTIN. CDNUR: credit notes against B2CL invoices.
 * - EXEMP: 0% lines as nil-rated, by inter/intra-state and registered/unregistered (question 12).
 * - HSN: B2B and B2C tables, by HSN, UQC and rate (question 13). DOCS: number ranges per series,
 *   cancelled invoices counted in the period they were issued (question 14).
 * - Cancelled invoices appear only in DOCS.
 */

export interface Gstr1Line {
  rateBp: number;
  taxablePaise: bigint;
  igstPaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  hsn: string | null;
  /** "NOS-NUMBERS", as the offline tool writes units. */
  uqc: string;
  qtyMilli: bigint;
}

export interface Gstr1Invoice {
  number: string;
  date: string;
  cancelled: boolean;
  recipientGstin: string | null;
  recipientName: string | null;
  /** State code. */
  placeOfSupply: string;
  interState: boolean;
  totalPaise: bigint;
  lines: Gstr1Line[];
}

export interface Gstr1Note {
  number: string;
  date: string;
  recipientGstin: string | null;
  recipientName: string | null;
  placeOfSupply: string;
  interState: boolean;
  totalPaise: bigint;
  /** The value of the invoice it reduces: decides whether that was a B2CL sale. */
  invoiceTotalPaise: bigint;
  lines: Gstr1Line[];
}

export interface Gstr1Input {
  invoices: readonly Gstr1Invoice[];
  notes: readonly Gstr1Note[];
  b2clThresholdPaise: bigint;
}

export interface B2bRow {
  gstin: string;
  name: string | null;
  number: string;
  date: string;
  invoiceValuePaise: bigint;
  placeOfSupply: string;
  rateBp: number;
  taxablePaise: bigint;
}

export interface B2clRow {
  number: string;
  date: string;
  invoiceValuePaise: bigint;
  placeOfSupply: string;
  rateBp: number;
  taxablePaise: bigint;
}

export interface B2csRow {
  placeOfSupply: string;
  rateBp: number;
  taxablePaise: bigint;
}

export interface CdnrRow {
  gstin: string;
  name: string | null;
  noteNumber: string;
  noteDate: string;
  placeOfSupply: string;
  noteValuePaise: bigint;
  rateBp: number;
  taxablePaise: bigint;
}

export interface CdnurRow {
  noteNumber: string;
  noteDate: string;
  placeOfSupply: string;
  noteValuePaise: bigint;
  rateBp: number;
  taxablePaise: bigint;
}

export const EXEMP_SUPPLIES = [
  "INTER_REGISTERED",
  "INTRA_REGISTERED",
  "INTER_UNREGISTERED",
  "INTRA_UNREGISTERED",
] as const;
export type ExempSupply = (typeof EXEMP_SUPPLIES)[number];

export interface ExempRow {
  supply: ExempSupply;
  nilRatedPaise: bigint;
}

export interface Gstr1HsnRow {
  hsn: string | null;
  uqc: string;
  rateBp: number;
  qtyMilli: bigint;
  totalValuePaise: bigint;
  taxablePaise: bigint;
  igstPaise: bigint;
  cgstPaise: bigint;
  /** State or UT tax. */
  sgstPaise: bigint;
}

export interface DocRow {
  nature: "INVOICES" | "CREDIT_NOTES";
  from: string;
  to: string;
  total: number;
  cancelled: number;
}

export interface Gstr1Report {
  b2b: B2bRow[];
  b2cl: B2clRow[];
  b2cs: B2csRow[];
  cdnr: CdnrRow[];
  cdnur: CdnurRow[];
  exemp: ExempRow[];
  hsnB2b: Gstr1HsnRow[];
  hsnB2c: Gstr1HsnRow[];
  docs: DocRow[];
  /** Lines of live documents with no HSN/SAC: the HSN tables need one. */
  linesWithoutHsn: number;
}

/** Σ taxable of the taxed lines (rate above 0), by rate, lowest first. */
function byRate(lines: readonly Gstr1Line[]): [number, bigint][] {
  const rates = new Map<number, bigint>();
  for (const line of lines) {
    if (line.rateBp === 0) continue;
    rates.set(line.rateBp, (rates.get(line.rateBp) ?? 0n) + line.taxablePaise);
  }
  return [...rates.entries()].sort((a, b) => a[0] - b[0]);
}

function nilRated(lines: readonly Gstr1Line[]): bigint {
  return lines.reduce((sum, line) => (line.rateBp === 0 ? sum + line.taxablePaise : sum), 0n);
}

function exempKey(registered: boolean, interState: boolean): ExempSupply {
  if (registered) return interState ? "INTER_REGISTERED" : "INTRA_REGISTERED";
  return interState ? "INTER_UNREGISTERED" : "INTRA_UNREGISTERED";
}

class HsnTable {
  private readonly rows = new Map<string, Gstr1HsnRow>();

  add(lines: readonly Gstr1Line[], sign: bigint): void {
    for (const line of lines) {
      const key = `${line.hsn ?? ""}|${line.uqc}|${String(line.rateBp)}`;
      const row = this.rows.get(key) ?? {
        hsn: line.hsn,
        uqc: line.uqc,
        rateBp: line.rateBp,
        qtyMilli: 0n,
        totalValuePaise: 0n,
        taxablePaise: 0n,
        igstPaise: 0n,
        cgstPaise: 0n,
        sgstPaise: 0n,
      };
      const state = line.sgstPaise + line.utgstPaise;
      row.qtyMilli += sign * line.qtyMilli;
      row.taxablePaise += sign * line.taxablePaise;
      row.igstPaise += sign * line.igstPaise;
      row.cgstPaise += sign * line.cgstPaise;
      row.sgstPaise += sign * state;
      row.totalValuePaise += sign * (line.taxablePaise + line.igstPaise + line.cgstPaise + state);
      this.rows.set(key, row);
    }
  }

  sorted(): Gstr1HsnRow[] {
    return [...this.rows.values()].sort(
      (a, b) =>
        Number(a.hsn === null) - Number(b.hsn === null) ||
        (a.hsn ?? "").localeCompare(b.hsn ?? "") ||
        a.uqc.localeCompare(b.uqc) ||
        a.rateBp - b.rateBp,
    );
  }
}

function docRow(
  nature: DocRow["nature"],
  documents: readonly { number: string; cancelled?: boolean }[],
): DocRow[] {
  if (documents.length === 0) return [];
  // Numbers of one series and FY sort as text (zero-padded).
  const from = documents.reduce(
    (min, doc) => (min === "" || doc.number < min ? doc.number : min),
    "",
  );
  const to = documents.reduce((max, doc) => (doc.number > max ? doc.number : max), "");
  return [
    {
      nature,
      from,
      to,
      total: documents.length,
      cancelled: documents.filter((doc) => doc.cancelled === true).length,
    },
  ];
}

export function buildGstr1(input: Gstr1Input): Gstr1Report {
  const { b2clThresholdPaise: threshold } = input;
  const b2b: B2bRow[] = [];
  const b2cl: B2clRow[] = [];
  const b2cs = new Map<string, B2csRow>();
  const cdnr: CdnrRow[] = [];
  const cdnur: CdnurRow[] = [];
  const exemp: Record<ExempSupply, bigint> = {
    INTER_REGISTERED: 0n,
    INTRA_REGISTERED: 0n,
    INTER_UNREGISTERED: 0n,
    INTRA_UNREGISTERED: 0n,
  };
  const hsnB2b = new HsnTable();
  const hsnB2c = new HsnTable();
  let linesWithoutHsn = 0;

  const toB2cs = (placeOfSupply: string, rateBp: number, taxable: bigint) => {
    const key = `${placeOfSupply}|${String(rateBp)}`;
    const row = b2cs.get(key) ?? { placeOfSupply, rateBp, taxablePaise: 0n };
    row.taxablePaise += taxable;
    b2cs.set(key, row);
  };
  const isB2cl = (interState: boolean, value: bigint) => interState && value > threshold;
  const addExemp = (registered: boolean, interState: boolean, amount: bigint) => {
    exemp[exempKey(registered, interState)] += amount;
  };

  for (const invoice of input.invoices) {
    if (invoice.cancelled) continue;
    const gstin = invoice.recipientGstin;
    linesWithoutHsn += invoice.lines.filter((line) => line.hsn === null).length;
    addExemp(gstin !== null, invoice.interState, nilRated(invoice.lines));
    (gstin === null ? hsnB2c : hsnB2b).add(invoice.lines, 1n);
    for (const [rateBp, taxablePaise] of byRate(invoice.lines)) {
      const common = {
        number: invoice.number,
        date: invoice.date,
        invoiceValuePaise: invoice.totalPaise,
        placeOfSupply: invoice.placeOfSupply,
        rateBp,
        taxablePaise,
      };
      if (gstin !== null) b2b.push({ gstin, name: invoice.recipientName, ...common });
      else if (isB2cl(invoice.interState, invoice.totalPaise)) b2cl.push(common);
      else toB2cs(invoice.placeOfSupply, rateBp, taxablePaise);
    }
  }

  for (const note of input.notes) {
    const gstin = note.recipientGstin;
    linesWithoutHsn += note.lines.filter((line) => line.hsn === null).length;
    addExemp(gstin !== null, note.interState, -nilRated(note.lines));
    (gstin === null ? hsnB2c : hsnB2b).add(note.lines, -1n);
    for (const [rateBp, taxablePaise] of byRate(note.lines)) {
      const common = {
        noteNumber: note.number,
        noteDate: note.date,
        placeOfSupply: note.placeOfSupply,
        noteValuePaise: note.totalPaise,
        rateBp,
        taxablePaise,
      };
      if (gstin !== null) cdnr.push({ gstin, name: note.recipientName, ...common });
      else if (isB2cl(note.interState, note.invoiceTotalPaise)) cdnur.push(common);
      else toB2cs(note.placeOfSupply, rateBp, -taxablePaise);
    }
  }

  return {
    b2b,
    b2cl,
    b2cs: [...b2cs.values()].sort(
      (a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rateBp - b.rateBp,
    ),
    cdnr,
    cdnur,
    exemp: EXEMP_SUPPLIES.map((supply) => ({ supply, nilRatedPaise: exemp[supply] })),
    hsnB2b: hsnB2b.sorted(),
    hsnB2c: hsnB2c.sorted(),
    docs: [...docRow("INVOICES", input.invoices), ...docRow("CREDIT_NOTES", input.notes)],
    linesWithoutHsn,
  };
}
