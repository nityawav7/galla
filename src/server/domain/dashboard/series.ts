import { addDays } from "../fy";

/*
 * The dashboard's daily chart (SPEC F8): one point per day, empty days at zero, so a quiet day
 * shows as a gap rather than disappearing.
 */

export interface DayValue {
  /** ISO business date (Asia/Kolkata). */
  date: string;
  valuePaise: bigint;
}

/** The `days` days ending on `endDate`, oldest first; rows outside them are ignored. */
export function dailySeries(rows: readonly DayValue[], endDate: string, days: number): DayValue[] {
  const totals = new Map<string, bigint>();
  for (const row of rows) totals.set(row.date, (totals.get(row.date) ?? 0n) + row.valuePaise);
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(endDate, index - days + 1);
    return { date, valuePaise: totals.get(date) ?? 0n };
  });
}
