import { addDays, fyForDate } from "../fy";

/*
 * GSTR-1 return periods (decision 13 of the Phase 9 plan): a month ("2026-11"), or a quarter of a
 * financial year for QRMP filers ("26-27-Q3" = October to December 2026).
 */

export interface Gstr1Period {
  value: string;
  kind: "month" | "quarter";
  from: string;
  to: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER = /^(\d{2})-(\d{2})-Q([1-4])$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** The last day of a month: the day before the next month's first. */
function monthEnd(year: number, month: number): string {
  const next = month === 12 ? `${String(year + 1)}-01-01` : `${String(year)}-${pad(month + 1)}-01`;
  return addDays(next, -1);
}

export function parseGstr1Period(value: string): Gstr1Period | null {
  const month = MONTH.exec(value);
  if (month) {
    const year = Number(month[1]);
    const m = Number(month[2]);
    return { value, kind: "month", from: `${String(year)}-${pad(m)}-01`, to: monthEnd(year, m) };
  }
  const quarter = QUARTER.exec(value);
  if (!quarter || (Number(quarter[1]) + 1) % 100 !== Number(quarter[2])) return null;
  const startYear = 2000 + Number(quarter[1]);
  const q = Number(quarter[3]);
  // Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec of the first year; Q4 Jan–Mar of the next.
  const year = q === 4 ? startYear + 1 : startYear;
  const first = q === 4 ? 1 : q * 3 + 1;
  return {
    value,
    kind: "quarter",
    from: `${String(year)}-${pad(first)}-01`,
    to: monthEnd(year, first + 2),
  };
}

/** This and the last 11 months, newest first; this and the last 3 quarters. */
export function gstr1Periods(today: string): { months: string[]; quarters: string[] } {
  const months: string[] = [];
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < 12; i += 1) {
    months.push(`${String(year)}-${pad(month)}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  const quarters: string[] = [];
  let fy = fyForDate(today);
  const current = Number(today.slice(5, 7));
  let q = current >= 4 ? Math.floor((current - 4) / 3) + 1 : 4;
  for (let i = 0; i < 4; i += 1) {
    quarters.push(`${fy}-Q${String(q)}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      const start = Number(fy.slice(0, 2)) - 1;
      fy = `${pad((start + 100) % 100)}-${pad((start + 101) % 100)}`;
    }
  }
  return { months, quarters };
}
