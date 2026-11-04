/**
 * CSV for imports (RFC 4180, read leniently). Pure and dependency-free (ADR 0005).
 *
 * Reading: quoted cells may hold commas, newlines and doubled quotes; CRLF, LF and lone CR
 * all end a line; Excel's byte order mark is dropped; empty lines are skipped. Each record
 * keeps the line it starts on, so errors can point at the line a person sees in their editor.
 */

export interface CsvRecord {
  /** 1-based line where the record starts. */
  line: number;
  cells: string[];
}

export type CsvParseResult =
  { ok: true; records: CsvRecord[] } | { ok: false; reason: "UNCLOSED_QUOTE"; line: number };

const BOM = "﻿";

export function parseCsv(input: string): CsvParseResult {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  // Whether the current record has any characters at all (an empty line has none).
  let touched = false;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;

  const endRecord = () => {
    if (touched) records.push({ line: recordLine, cells: [...cells, cell] });
    cells = [];
    cell = "";
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
        continue;
      }
      if (char === "\n" || (char === "\r" && text.charAt(i + 1) !== "\n")) line++;
      cell += char;
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text.charAt(i + 1) === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    touched = true;
    if (char === ",") {
      cells.push(cell);
      cell = "";
    } else if (char === '"' && cell === "") {
      inQuotes = true;
      quoteLine = line;
    } else {
      cell += char;
    }
  }

  if (inQuotes) return { ok: false, reason: "UNCLOSED_QUOTE", line: quoteLine };
  endRecord();
  return { ok: true, records };
}

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function quote(cell: string): string {
  return NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** Writes rows as CSV with CRLF line ends. Reading the result with `parseCsv` gives `rows`. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => (row.length === 1 && row[0] === "" ? '""' : row.map(quote).join(",")))
    .map((row) => `${row}\r\n`)
    .join("");
}
