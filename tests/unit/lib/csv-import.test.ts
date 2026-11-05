import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  duplicatesInFile,
  importSize,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  readImportRows,
  validateImportRows,
} from "@/lib/validation/csv-import";

const COLUMNS = ["name", "price", "sku"] as const;
const REQUIRED = ["name", "price"] as const;
type Column = (typeof COLUMNS)[number];

describe("readImportRows", () => {
  it("keys each row by column, matching headers loosely and filling missing cells", () => {
    expect(readImportRows("Name ,PRICE\nCement,420\nSand", COLUMNS, REQUIRED)).toEqual({
      ok: true,
      rows: [
        { line: 2, values: { name: "Cement", price: "420", sku: "" } },
        { line: 3, values: { name: "Sand", price: "", sku: "" } },
      ],
    });
  });

  it("ignores blank header cells", () => {
    expect(readImportRows("name,,price\nA,x,1", COLUMNS, REQUIRED)).toMatchObject({
      ok: true,
      rows: [{ values: { name: "A", price: "1" } }],
    });
  });

  it("reports unknown, duplicate and missing columns together", () => {
    expect(readImportRows("name,colour,name\nA,red,A", COLUMNS, REQUIRED)).toEqual({
      ok: false,
      issues: [
        { line: null, column: "colour", key: "csvUnknownColumn" },
        { line: null, column: "name", key: "csvDuplicateColumn" },
        { line: null, column: "price", key: "csvColumnMissing" },
      ],
    });
  });

  it.each([
    ["", "csvEmpty"],
    ["name,price\n", "csvEmpty"],
  ])("reports an empty file %j", (text, key) => {
    expect(readImportRows(text, COLUMNS, REQUIRED)).toEqual({
      ok: false,
      issues: [{ line: null, column: null, key }],
    });
  });

  it("reports an unclosed quote with its line", () => {
    expect(readImportRows('name,price\n"A,1', COLUMNS, REQUIRED)).toEqual({
      ok: false,
      issues: [{ line: 2, column: null, key: "csvUnclosedQuote" }],
    });
  });

  it("refuses files over the row and size limits", () => {
    const rows = "A,1\n".repeat(MAX_IMPORT_ROWS + 1);
    expect(readImportRows(`name,price\n${rows}`, COLUMNS, REQUIRED)).toEqual({
      ok: false,
      issues: [{ line: null, column: null, key: "csvTooManyRows" }],
    });
    const big = `name,price\n${"x".repeat(MAX_IMPORT_BYTES)}`;
    expect(readImportRows(big, COLUMNS, REQUIRED)).toEqual({
      ok: false,
      issues: [{ line: null, column: null, key: "csvTooLarge" }],
    });
  });

  it("measures size in UTF-8 bytes", () => {
    expect(importSize("₹")).toBe(3);
  });
});

describe("validateImportRows", () => {
  const schema = z.object({
    name: z.string().min(1, { error: "productNameRequired" }),
    price: z.string().regex(/^[0-9]+$/, { error: "priceInvalid" }),
    extra: z.string().refine(() => false, { error: "not a validation key" }),
  });
  const fieldColumns: Record<string, Column> = { name: "name", price: "price" };

  it("returns valid rows and maps errors to lines and columns", () => {
    const ok = z.object({ name: z.string().min(1, { error: "productNameRequired" }) });
    const result = validateImportRows(
      [
        { line: 2, values: { name: "A", price: "1", sku: "" } },
        { line: 3, values: { name: "", price: "1", sku: "" } },
      ],
      (values) => ({ name: values.name }),
      ok,
      fieldColumns,
    );
    expect(result).toEqual({
      valid: [{ line: 2, value: { name: "A" } }],
      issues: [{ line: 3, column: "name", key: "productNameRequired" }],
    });
  });

  it("falls back to a generic key and no column for unexpected issues", () => {
    const result = validateImportRows(
      [{ line: 4, values: { name: "", price: "x", sku: "" } }],
      (values) => ({ ...values, extra: "" }),
      schema,
      fieldColumns,
    );
    expect(result.issues).toEqual([
      { line: 4, column: "name", key: "productNameRequired" },
      { line: 4, column: "price", key: "priceInvalid" },
      { line: 4, column: null, key: "csvRowInvalid" },
    ]);
  });
});

describe("duplicatesInFile", () => {
  it("flags repeats after the first, skipping empty values", () => {
    const rows: { line: number; value: { sku: string | null } }[] = [
      { line: 2, value: { sku: "A" } },
      { line: 3, value: { sku: null } },
      { line: 4, value: { sku: "A" } },
      { line: 5, value: { sku: null } },
      { line: 6, value: { sku: "a" } },
    ];
    expect(duplicatesInFile(rows, (v) => v.sku, "sku")).toEqual([
      { line: 4, column: "sku", key: "csvDuplicateInFile" },
    ]);
  });
});
