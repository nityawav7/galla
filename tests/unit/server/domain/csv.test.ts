import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseCsv, toCsv } from "@/server/domain/csv";

function cells(text: string): string[][] {
  const result = parseCsv(text);
  if (!result.ok) throw new Error(`unexpected ${result.reason}`);
  return result.records.map((record) => record.cells);
}

describe("parseCsv", () => {
  it("splits simple rows and cells", () => {
    expect(cells("name,price\nCement,420\n")).toEqual([
      ["name", "price"],
      ["Cement", "420"],
    ]);
  });

  it("accepts CRLF, LF and lone CR line endings", () => {
    expect(cells("a,b\r\nc,d\re,f\ng,h")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("strips the byte order mark Excel adds", () => {
    expect(cells("﻿name\nCement")).toEqual([["name"], ["Cement"]]);
  });

  it("reads quoted cells with commas, escaped quotes and newlines", () => {
    expect(cells('name,notes\n"Pipe, 1""","  line 1\nline 2"\n')).toEqual([
      ["name", "notes"],
      ['Pipe, 1"', "  line 1\nline 2"],
    ]);
  });

  it("keeps empty cells, including a trailing one", () => {
    expect(cells("a,,c,\n,,,")).toEqual([
      ["a", "", "c", ""],
      ["", "", "", ""],
    ]);
  });

  it("skips blank lines but keeps a quoted empty cell", () => {
    expect(cells('a\n\n\r\n""\nb\n\n')).toEqual([["a"], [""], ["b"]]);
  });

  it("keeps a stray quote inside an unquoted cell, and text after a closing quote", () => {
    expect(cells('5" pipe,"a"b')).toEqual([['5" pipe', "ab"]]);
  });

  it("numbers each record by the line it starts on", () => {
    const result = parseCsv('h\n\n"multi\nline"\nlast');
    expect(result).toEqual({
      ok: true,
      records: [
        { line: 1, cells: ["h"] },
        { line: 3, cells: ["multi\nline"] },
        { line: 5, cells: ["last"] },
      ],
    });
  });

  it("returns no records for empty input", () => {
    expect(parseCsv("")).toEqual({ ok: true, records: [] });
    expect(parseCsv("﻿\r\n\n")).toEqual({ ok: true, records: [] });
  });

  it("reports an unclosed quote with the line it opened on", () => {
    expect(parseCsv('name\nok\n"broken,\nstill open')).toEqual({
      ok: false,
      reason: "UNCLOSED_QUOTE",
      line: 3,
    });
  });
});

describe("toCsv", () => {
  it("quotes only cells that need it and ends lines with CRLF", () => {
    expect(toCsv([["name", "notes"], ['Pipe, 1"', "plain"], [" padded "]])).toBe(
      'name,notes\r\n"Pipe, 1""",plain\r\n" padded "\r\n',
    );
  });

  it("quotes a lone empty cell so the row is not read as blank", () => {
    expect(toCsv([[""], ["", ""]])).toBe('""\r\n,\r\n');
  });

  it("round-trips any table through parseCsv", () => {
    const cell = fc.string({
      unit: fc.constantFrom("a", "Z", "1", " ", ",", '"', "\n", "\r", "₹"),
    });
    fc.assert(
      fc.property(
        fc.array(fc.array(cell, { minLength: 1, maxLength: 5 }), { maxLength: 6 }),
        (rows) => {
          expect(cells(toCsv(rows))).toEqual(rows);
        },
      ),
    );
  });
});
