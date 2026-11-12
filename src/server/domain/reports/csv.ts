/*
 * CSV for the reports (SPEC F8): UTF-8 with a byte-order mark so Excel shows ₹ and Hindi, CRLF
 * line ends, RFC 4180 quoting. A cell that a spreadsheet would run as a formula (starting with
 * = + - @, tab or CR) gets a leading apostrophe, unless it is a plain number.
 */

const NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA = /^[=+\-@\t\r]/;

function cell(value: string): string {
  const safe = FORMULA.test(value) && !NUMBER.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
