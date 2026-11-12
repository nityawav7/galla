import { addDays, daysBetween, fyForDate, fyRange, isValidIsoDate } from "../fy";

/*
 * The report period picker (decision 10 of the Phase 9 plan): presets in business dates
 * (Asia/Kolkata) up to today, financial quarters Apr–Jun, Jul–Sep, Oct–Dec and Jan–Mar.
 */

export const REPORT_PRESETS = [
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "lastQuarter",
  "thisFy",
] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export interface DateRange {
  from: string;
  to: string;
}

const firstOfMonth = (date: string) => `${date.slice(0, 8)}01`;

/** The first day of the financial quarter `date` falls in. */
function quarterStart(date: string): string {
  const month = Number(date.slice(5, 7));
  const start = month >= 10 ? 10 : month >= 7 ? 7 : month >= 4 ? 4 : 1;
  return `${date.slice(0, 4)}-${String(start).padStart(2, "0")}-01`;
}

export function presetRange(preset: ReportPreset, today: string): DateRange {
  switch (preset) {
    case "thisMonth":
      return { from: firstOfMonth(today), to: today };
    case "lastMonth": {
      const end = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(end), to: end };
    }
    case "thisQuarter":
      return { from: quarterStart(today), to: today };
    case "lastQuarter": {
      const end = addDays(quarterStart(today), -1);
      return { from: quarterStart(end), to: end };
    }
    case "thisFy":
      return { from: fyRange(fyForDate(today)).startDate, to: today };
  }
}

/** A validation key when a custom range can't be used, or null. `maxDays` counts both ends. */
export function rangeProblem(
  from: string,
  to: string,
  maxDays: number,
): "dateInvalid" | "rangeReversed" | "rangeTooLong" | null {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return "dateInvalid";
  if (from > to) return "rangeReversed";
  if (daysBetween(from, to) + 1 > maxDays) return "rangeTooLong";
  return null;
}
