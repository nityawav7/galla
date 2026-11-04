import { type z } from "zod";

import { parseCsv } from "@/server/domain/csv";

import { isValidationKey, type ValidationKey } from "./messages";

/**
 * Reading an import file into rows keyed by column (ADR 0005). Shared by the import services;
 * the limits are also checked in the browser before uploading.
 */

/** Under Next's 1 MB server action body limit, with room for the request wrapper. */
export const MAX_IMPORT_BYTES = 900_000;
export const MAX_IMPORT_ROWS = 1000;

/** A problem with the file (line null) or with one cell or row of it. */
export interface ImportIssue {
  line: number | null;
  column: string | null;
  key: ValidationKey;
}

/** What an import preview (or a refused import) sends back to the browser. */
export interface ImportReport<S> {
  /** Data rows in the file (0 when the file itself could not be read). */
  total: number;
  /** Rows that would be imported if there were no issues. */
  valid: number;
  issueCount: number;
  /** The first issues, ordered by line; `issueCount` says how many there were in all. */
  issues: ImportIssue[];
  /** The first rows as they would be saved, formatted for display. */
  sample: S[];
}

export type ImportResult<S> =
  { status: "imported"; count: number } | { status: "invalid"; report: ImportReport<S> };

export interface ImportRow<C extends string> {
  line: number;
  values: Record<C, string>;
}

export type ImportRows<C extends string> =
  { ok: true; rows: ImportRow<C>[] } | { ok: false; issues: ImportIssue[] };

const fileIssue = (key: ValidationKey, column: string | null = null): ImportIssue => ({
  line: null,
  column,
  key,
});

/** "HSN SAC " → "hsn_sac", so headers typed by hand still match. */
function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/\s+/g, "_");
}

export function importSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function readImportRows<C extends string>(
  text: string,
  columns: readonly C[],
  required: readonly C[],
): ImportRows<C> {
  if (importSize(text) > MAX_IMPORT_BYTES) return { ok: false, issues: [fileIssue("csvTooLarge")] };
  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return { ok: false, issues: [{ line: parsed.line, column: null, key: "csvUnclosedQuote" }] };
  }
  const [header, ...records] = parsed.records;
  if (!header) return { ok: false, issues: [fileIssue("csvEmpty")] };

  const names = header.cells.map(normalizeHeader);
  const issues: ImportIssue[] = [];
  names.forEach((name, index) => {
    if (!name) return;
    if (!(columns as readonly string[]).includes(name)) {
      issues.push(fileIssue("csvUnknownColumn", name));
    } else if (names.indexOf(name) !== index) {
      issues.push(fileIssue("csvDuplicateColumn", name));
    }
  });
  for (const column of required) {
    if (!names.includes(column)) issues.push(fileIssue("csvColumnMissing", column));
  }
  if (records.length === 0) issues.push(fileIssue("csvEmpty"));
  if (records.length > MAX_IMPORT_ROWS) issues.push(fileIssue("csvTooManyRows"));
  if (issues.length > 0) return { ok: false, issues };

  const rows = records.map(({ line, cells }) => {
    const values = Object.fromEntries(
      columns.map((column) => {
        const index = names.indexOf(column);
        return [column, index === -1 ? "" : (cells[index] ?? "")];
      }),
    ) as Record<C, string>;
    return { line, values };
  });
  return { ok: true, rows };
}

/**
 * Checks each row with `schema`. Errors point at the row's line and the column of the field
 * that failed (`fieldColumns`), so a person can find the cell in their spreadsheet.
 */
export function validateImportRows<C extends string, S extends z.ZodType>(
  rows: readonly ImportRow<C>[],
  toInput: (values: Record<C, string>) => z.input<S>,
  schema: S,
  fieldColumns: Readonly<Record<string, C>>,
): { valid: { line: number; value: z.output<S> }[]; issues: ImportIssue[] } {
  const valid: { line: number; value: z.output<S> }[] = [];
  const issues: ImportIssue[] = [];
  for (const { line, values } of rows) {
    const result = schema.safeParse(toInput(values));
    if (result.success) {
      valid.push({ line, value: result.data });
      continue;
    }
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? "");
      issues.push({
        line,
        column: fieldColumns[field] ?? null,
        key: isValidationKey(issue.message) ? issue.message : "csvRowInvalid",
      });
    }
  }
  return { valid, issues };
}

/** Rows whose (already normalised) value appears on an earlier row too, as issues on `column`. */
export function duplicatesInFile<T>(
  rows: readonly { line: number; value: T }[],
  pick: (value: T) => string | null,
  column: string,
): ImportIssue[] {
  const seen = new Set<string>();
  const issues: ImportIssue[] = [];
  for (const { line, value } of rows) {
    const key = pick(value);
    if (!key) continue;
    if (seen.has(key)) issues.push({ line, column, key: "csvDuplicateInFile" });
    seen.add(key);
  }
  return issues;
}
