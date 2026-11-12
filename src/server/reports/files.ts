import { createTranslator } from "next-intl";
import writeExcelFile from "write-excel-file/node";

import messages from "@/messages/en.json";
import { formatIndianDate } from "@/server/domain/fy";
import { formatRate } from "@/server/domain/invoice/printable";
import { formatRupees } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/quantity";
import { toCsv } from "@/server/domain/reports/csv";
import { type HsnRow, type HsnTotals } from "@/server/domain/reports/hsn";
import { type RegisterRow, type RegisterTotals } from "@/server/domain/reports/register";
import { findState } from "@/server/domain/states";

/*
 * Report files (SPEC F8): CSV and Excel built from the pure report rows. Labels are English, like
 * the PDFs (decision 7 of the Phase 7 plan). Amounts are rupees with two decimals; paise become a
 * spreadsheet number only here, at the edge, so Excel can add them up. Filenames carry the dates,
 * never a name. Nothing is stored.
 */

export interface DownloadFile {
  filename: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export const CSV_TYPE = "text/csv; charset=utf-8";
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function translator() {
  return createTranslator({ locale: "en", messages, namespace: "reports.export" });
}

interface Period {
  from: string;
  to: string;
}

const rupees = (paise: bigint) => formatRupees(paise);
const spreadsheetNumber = (paise: bigint) => Number(formatRupees(paise));

function place(code: string): string {
  const state = findState(code);
  return state ? `${state.name} (${state.code})` : code;
}

function bytes(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

const AMOUNTS = [
  "taxablePaise",
  "cgstPaise",
  "sgstPaise",
  "utgstPaise",
  "igstPaise",
  "roundOffPaise",
  "totalPaise",
] as const;

function registerHeader(t: ReturnType<typeof translator>): string[] {
  return [
    t("date"),
    t("type"),
    t("number"),
    t("against"),
    t("customer"),
    t("gstin"),
    t("placeOfSupply"),
    t("status"),
    t("taxable"),
    t("cgst"),
    t("sgst"),
    t("utgst"),
    t("igst"),
    t("roundOff"),
    t("total"),
    t("paid"),
    t("credited"),
    t("balance"),
  ];
}

function registerText(t: ReturnType<typeof translator>, row: RegisterRow): string[] {
  return [
    formatIndianDate(row.date),
    t(row.kind === "INVOICE" ? "invoice" : "creditNote"),
    row.number,
    row.against ?? "",
    row.customer ?? t("walkIn"),
    row.gstin ?? "",
    place(row.placeOfSupply),
    t(`statuses.${row.status}`),
    ...AMOUNTS.map((key) => rupees(row[key])),
    rupees(row.paidPaise),
    rupees(row.creditedPaise),
    rupees(row.balancePaise),
  ];
}

function filename(kind: string, period: Period, extension: string): string {
  return `${kind}-${period.from}-to-${period.to}.${extension}`;
}

export function salesRegisterCsv(register: {
  period: Period;
  rows: RegisterRow[];
  totals: RegisterTotals;
}): DownloadFile {
  const t = translator();
  const { rows, totals } = register;
  const csv = toCsv([
    registerHeader(t),
    ...rows.map((row) => registerText(t, row)),
    [
      t("totals"),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ...AMOUNTS.map((key) => rupees(totals[key])),
      "",
      "",
      "",
    ],
  ]);
  return {
    filename: filename("sales-register", register.period, "csv"),
    contentType: CSV_TYPE,
    bytes: bytes(csv),
  };
}

type Cell = { value: string | number; fontWeight?: "bold"; format?: string } | null;

const MONEY_FORMAT = "#,##0.00";

function registerSheet(t: ReturnType<typeof translator>, rows: readonly RegisterRow[]): Cell[][] {
  const header = registerHeader(t).map((value): Cell => ({ value, fontWeight: "bold" }));
  const body = rows.map((row): Cell[] => {
    const text = registerText(t, row);
    return [
      ...text.slice(0, 8).map((value): Cell => ({ value })),
      ...[
        ...AMOUNTS.map((key) => row[key]),
        row.paidPaise,
        row.creditedPaise,
        row.balancePaise,
      ].map((paise): Cell => ({ value: spreadsheetNumber(paise), format: MONEY_FORMAT })),
    ];
  });
  const sum = (key: (typeof AMOUNTS)[number]) => rows.reduce((total, row) => total + row[key], 0n);
  const footer: Cell[] = [
    { value: t("totals"), fontWeight: "bold" },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    ...AMOUNTS.map((key): Cell => ({
      value: spreadsheetNumber(sum(key)),
      format: MONEY_FORMAT,
      fontWeight: "bold",
    })),
    null,
    null,
    null,
  ];
  return [header, ...body, footer];
}

const REGISTER_WIDTHS = [12, 12, 16, 16, 28, 17, 22, 12, 13, 11, 11, 11, 11, 10, 13, 13, 13, 13];

export async function salesRegisterXlsx(register: {
  period: Period;
  rows: RegisterRow[];
  totals: RegisterTotals;
}): Promise<DownloadFile> {
  const t = translator();
  const columns = REGISTER_WIDTHS.map((width) => ({ width }));
  const buffer = await writeExcelFile([
    {
      data: registerSheet(
        t,
        register.rows.filter((row) => row.kind === "INVOICE"),
      ),
      sheet: t("invoicesSheet"),
      columns,
      stickyRowsCount: 1,
    },
    {
      data: registerSheet(
        t,
        register.rows.filter((row) => row.kind === "CREDIT_NOTE"),
      ),
      sheet: t("creditNotesSheet"),
      columns,
      stickyRowsCount: 1,
    },
  ]).toBuffer();
  return {
    filename: filename("sales-register", register.period, "xlsx"),
    contentType: XLSX_TYPE,
    bytes: new Uint8Array(buffer),
  };
}

export function hsnCsv(report: {
  period: Period;
  rows: HsnRow[];
  totals: HsnTotals;
}): DownloadFile {
  const t = translator();
  const csv = toCsv([
    [
      t("hsn"),
      t("uqc"),
      t("rate"),
      t("quantity"),
      t("taxable"),
      t("igst"),
      t("cgst"),
      t("sgstUtgst"),
      t("totalValue"),
    ],
    ...report.rows.map((row) => [
      row.hsn ?? t("noHsn"),
      row.uqc,
      formatRate(row.rateBp),
      formatQuantity(row.qtyMilli),
      rupees(row.taxablePaise),
      rupees(row.igstPaise),
      rupees(row.cgstPaise),
      rupees(row.sgstPaise),
      rupees(row.totalPaise),
    ]),
    [
      t("totals"),
      "",
      "",
      "",
      rupees(report.totals.taxablePaise),
      rupees(report.totals.igstPaise),
      rupees(report.totals.cgstPaise),
      rupees(report.totals.sgstPaise),
      rupees(report.totals.totalPaise),
    ],
  ]);
  return {
    filename: filename("hsn-summary", report.period, "csv"),
    contentType: CSV_TYPE,
    bytes: bytes(csv),
  };
}
