/**
 * Business dates and financial years (SPEC §4.6). India has no daylight saving, so
 * Asia/Kolkata is always UTC+05:30 and plain arithmetic is exact.
 *
 * Dates are ISO calendar strings ("2026-04-01"), matching Postgres `date`.
 */

import { ValidationError } from "@/lib/errors";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FY_LABEL = /^(\d{2})-(\d{2})$/;

// Two-digit labels ("26-27") are unambiguous only within one century.
const FIRST_FY_START_YEAR = 2000;
const LAST_FY_START_YEAR = 2099;

export interface FyRange {
  startDate: string;
  endDate: string;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseIsoDateParts(date: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidIsoDate(date: string): boolean {
  return parseIsoDateParts(date) !== null;
}

/** The calendar date in India at a given instant. */
export function istDateFromInstant(instant: Date): string {
  const time = instant.getTime();
  if (Number.isNaN(time)) throw new RangeError("Invalid date");
  return new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function twoDigits(year: number): string {
  return String(year % 100).padStart(2, "0");
}

/** Financial year label for a business date: 2026-04-01 → "26-27". */
export function fyForDate(date: string): string {
  const parts = parseIsoDateParts(date);
  if (!parts) {
    throw new ValidationError("Enter a valid date", [{ path: "date", message: "Invalid date" }]);
  }
  const startYear = parts.month >= 4 ? parts.year : parts.year - 1;
  if (startYear < FIRST_FY_START_YEAR || startYear > LAST_FY_START_YEAR) {
    throw new ValidationError("Date is outside the supported range", [
      { path: "date", message: "Unsupported date" },
    ]);
  }
  return `${twoDigits(startYear)}-${twoDigits(startYear + 1)}`;
}

export function fyForInstant(instant: Date): string {
  return fyForDate(istDateFromInstant(instant));
}

/** Validates an FY label such as "26-27" (consecutive years). */
export function parseFy(fy: string): string {
  const match = FY_LABEL.exec(fy);
  if (!match || (Number(match[1]) + 1) % 100 !== Number(match[2])) {
    throw new ValidationError("Financial year must look like 26-27", [
      { path: "fy", message: "Invalid financial year" },
    ]);
  }
  return fy;
}

export function fyRange(fy: string): FyRange {
  const startYear = FIRST_FY_START_YEAR + Number(parseFy(fy).slice(0, 2));
  return { startDate: `${String(startYear)}-04-01`, endDate: `${String(startYear + 1)}-03-31` };
}
