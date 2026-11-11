import { fyForDate, fyRange } from "../fy";

/**
 * The periods the customer page and the statement offer (decision 10 of the Phase 8 plan): from
 * the start of this or last financial year up to today, or everything. Earlier rows fold into the
 * balance brought forward.
 */
export const LEDGER_PERIODS = ["fy", "lastFy", "all"] as const;
export type LedgerPeriod = (typeof LEDGER_PERIODS)[number];

/** The first day shown, or null for all time. `today` is the business date in Asia/Kolkata. */
export function periodStart(period: LedgerPeriod, today: string): string | null {
  if (period === "all") return null;
  const { startDate } = fyRange(fyForDate(today));
  if (period === "fy") return startDate;
  return `${String(Number(startDate.slice(0, 4)) - 1)}-04-01`;
}
