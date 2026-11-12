import { createTranslator } from "next-intl";
import writeExcelFile from "write-excel-file/node";

import { B2CL_THRESHOLD_PAISE } from "@/lib/gst-config";
import messages from "@/messages/en.json";
import { type Gstr1Report } from "@/server/domain/gstr1/build";
import { formatINR, formatRupees } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/quantity";
import { findState } from "@/server/domain/states";

import { type DownloadFile, XLSX_TYPE } from "./files";

/*
 * The GSTR-1 helper workbook (SPEC §4.10, ADR 0013). Sheet names and column headers follow the GST
 * offline tool's Excel template so a CA can copy rows across; they are the template's own words,
 * so they are not translated. The first sheet says, before anything else, that this is a helper
 * and not a filed return. Amounts become spreadsheet numbers in rupees only here.
 */

type Cell = { value: string | number; fontWeight?: "bold"; format?: string } | null;
type Row = Cell[];

const MONEY = "#,##0.00";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-02" → "02-Nov-2026", the offline tool's date format. */
function toolDate(date: string): string {
  return `${date.slice(8, 10)}-${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}-${date.slice(0, 4)}`;
}

/** "29" → "29-Karnataka". */
function toolPlace(code: string): string {
  const state = findState(code);
  return state ? `${state.code}-${state.name}` : code;
}

const money = (paise: bigint): Cell => ({ value: Number(formatRupees(paise)), format: MONEY });
const text = (value: string): Cell => ({ value });
const number = (value: number): Cell => ({ value });
const rate = (bp: number): Cell => number(bp / 100);
const header = (names: readonly string[]): Row =>
  names.map((value): Cell => ({ value, fontWeight: "bold" }));

const B2B = [
  "GSTIN/UIN of Recipient",
  "Receiver Name",
  "Invoice Number",
  "Invoice date",
  "Invoice Value",
  "Place Of Supply",
  "Reverse Charge",
  "Applicable % of Tax Rate",
  "Invoice Type",
  "E-Commerce GSTIN",
  "Rate",
  "Taxable Value",
  "Cess Amount",
];
const B2CL = [
  "Invoice Number",
  "Invoice date",
  "Invoice Value",
  "Place Of Supply",
  "Applicable % of Tax Rate",
  "Rate",
  "Taxable Value",
  "Cess Amount",
  "E-Commerce GSTIN",
];
const B2CS = [
  "Type",
  "Place Of Supply",
  "Applicable % of Tax Rate",
  "Rate",
  "Taxable Value",
  "Cess Amount",
  "E-Commerce GSTIN",
];
const CDNR = [
  "GSTIN/UIN of Recipient",
  "Receiver Name",
  "Note Number",
  "Note Date",
  "Note Type",
  "Place Of Supply",
  "Reverse Charge",
  "Note Supply Type",
  "Note Value",
  "Applicable % of Tax Rate",
  "Rate",
  "Taxable Value",
  "Cess Amount",
];
const CDNUR = [
  "UR Type",
  "Note Number",
  "Note Date",
  "Note Type",
  "Place Of Supply",
  "Note Value",
  "Applicable % of Tax Rate",
  "Rate",
  "Taxable Value",
  "Cess Amount",
];
const EXEMP = [
  "Description",
  "Nil Rated Supplies",
  "Exempted(other than nil rated/non GST supply)",
  "Non-GST Supplies",
];
const EXEMP_LABELS = {
  INTER_REGISTERED: "Inter-State supplies to registered persons",
  INTRA_REGISTERED: "Intra-State supplies to registered persons",
  INTER_UNREGISTERED: "Inter-State supplies to unregistered persons",
  INTRA_UNREGISTERED: "Intra-State supplies to unregistered persons",
} as const;
const HSN = [
  "HSN",
  "Description",
  "UQC",
  "Total Quantity",
  "Total Value",
  "Rate",
  "Taxable Value",
  "Integrated Tax Amount",
  "Central Tax Amount",
  "State/UT Tax Amount",
  "Cess Amount",
];
const DOCS = ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"];
const DOC_NATURE = {
  INVOICES: "Invoices for outward supply",
  CREDIT_NOTES: "Credit Note",
} as const;

function hsnRows(rows: Gstr1Report["hsnB2b"]): Row[] {
  return rows.map((row) => [
    text(row.hsn ?? ""),
    text(""),
    text(row.uqc),
    number(Number(formatQuantity(row.qtyMilli))),
    money(row.totalValuePaise),
    rate(row.rateBp),
    money(row.taxablePaise),
    money(row.igstPaise),
    money(row.cgstPaise),
    money(row.sgstPaise),
    money(0n),
  ]);
}

export interface Gstr1Context {
  businessName: string;
  gstin: string;
  /** Already formatted, e.g. "November 2026". */
  periodLabel: string;
  /** "2026-11" or "26-27-Q3", for the filename. */
  periodValue: string;
  /** Formatted IST date and time. */
  generatedAt: string;
}

export async function gstr1Workbook(
  report: Gstr1Report,
  context: Gstr1Context,
): Promise<DownloadFile> {
  const t = createTranslator({ locale: "en", messages, namespace: "reports.gstr1.readme" });
  const readMe: Row[] = [
    [{ value: t("title"), fontWeight: "bold" }],
    [text(t("notFiled"))],
    [],
    [text(t("business")), text(context.businessName)],
    [text(t("gstin")), text(context.gstin)],
    [text(t("period")), text(context.periodLabel)],
    [text(t("generated")), text(context.generatedAt)],
    [],
    [{ value: t("checkTitle"), fontWeight: "bold" }],
    ...(report.linesWithoutHsn > 0 ? [[text(t("noHsn", { count: report.linesWithoutHsn }))]] : []),
    [text(t("b2cl", { threshold: formatINR(B2CL_THRESHOLD_PAISE) }))],
    [text(t("nilRated"))],
    [text(t("b2csNotes"))],
    [text(t("cancelled"))],
    [text(t("verify"))],
  ];
  const sheets = [
    { sheet: "Read me", data: readMe, columns: [{ width: 28 }, { width: 60 }] },
    {
      sheet: "b2b",
      data: [
        header(B2B),
        ...report.b2b.map((row): Row => [
          text(row.gstin),
          text(row.name ?? ""),
          text(row.number),
          text(toolDate(row.date)),
          money(row.invoiceValuePaise),
          text(toolPlace(row.placeOfSupply)),
          text("N"),
          text(""),
          text("Regular B2B"),
          text(""),
          rate(row.rateBp),
          money(row.taxablePaise),
          money(0n),
        ]),
      ],
    },
    {
      sheet: "b2cl",
      data: [
        header(B2CL),
        ...report.b2cl.map((row): Row => [
          text(row.number),
          text(toolDate(row.date)),
          money(row.invoiceValuePaise),
          text(toolPlace(row.placeOfSupply)),
          text(""),
          rate(row.rateBp),
          money(row.taxablePaise),
          money(0n),
          text(""),
        ]),
      ],
    },
    {
      sheet: "b2cs",
      data: [
        header(B2CS),
        ...report.b2cs.map((row): Row => [
          text("OE"),
          text(toolPlace(row.placeOfSupply)),
          text(""),
          rate(row.rateBp),
          money(row.taxablePaise),
          money(0n),
          text(""),
        ]),
      ],
    },
    {
      sheet: "cdnr",
      data: [
        header(CDNR),
        ...report.cdnr.map((row): Row => [
          text(row.gstin),
          text(row.name ?? ""),
          text(row.noteNumber),
          text(toolDate(row.noteDate)),
          text("C"),
          text(toolPlace(row.placeOfSupply)),
          text("N"),
          text("Regular B2B"),
          money(row.noteValuePaise),
          text(""),
          rate(row.rateBp),
          money(row.taxablePaise),
          money(0n),
        ]),
      ],
    },
    {
      sheet: "cdnur",
      data: [
        header(CDNUR),
        ...report.cdnur.map((row): Row => [
          text("B2CL"),
          text(row.noteNumber),
          text(toolDate(row.noteDate)),
          text("C"),
          text(toolPlace(row.placeOfSupply)),
          money(row.noteValuePaise),
          text(""),
          rate(row.rateBp),
          money(row.taxablePaise),
          money(0n),
        ]),
      ],
    },
    {
      sheet: "exemp",
      data: [
        header(EXEMP),
        ...report.exemp.map((row): Row => [
          text(EXEMP_LABELS[row.supply]),
          money(row.nilRatedPaise),
          money(0n),
          money(0n),
        ]),
      ],
    },
    { sheet: "hsn(b2b)", data: [header(HSN), ...hsnRows(report.hsnB2b)] },
    { sheet: "hsn(b2c)", data: [header(HSN), ...hsnRows(report.hsnB2c)] },
    {
      sheet: "docs",
      data: [
        header(DOCS),
        ...report.docs.map((row): Row => [
          text(DOC_NATURE[row.nature]),
          text(row.from),
          text(row.to),
          number(row.total),
          number(row.cancelled),
        ]),
      ],
    },
  ];
  const buffer = await writeExcelFile(
    sheets.map((sheet) => ({
      ...sheet,
      stickyRowsCount: sheet.sheet === "Read me" ? 0 : 1,
      columns:
        "columns" in sheet
          ? sheet.columns
          : (sheet.data[0] ?? []).map((cell) => ({
              width: Math.max(12, String(cell?.value ?? "").length + 2),
            })),
    })),
  ).toBuffer();
  return {
    filename: `gstr1-helper-${context.periodValue}.xlsx`,
    contentType: XLSX_TYPE,
    bytes: new Uint8Array(buffer),
  };
}
