/**
 * Which email reminder an invoice is due for today (SPEC F9, decision 7 of the Phase 10 plan):
 * `DUE` on the due date, then `D1`, `D7` and `D14` days overdue. A stage whose day had no run
 * still goes out up to `catchUpDays` late. Only the latest stage reached is ever chosen, and
 * never one already sent, so a stage goes out at most once and never after a later one.
 */

import { daysBetween } from "../fy";

export const REMINDER_KINDS = ["DUE", "D1", "D7", "D14"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** Days after the due date each stage is reached (from config, e.g. D7 → 7). */
export type ReminderStages = Readonly<Record<ReminderKind, number>>;

export interface ReminderSchedule {
  stages: ReminderStages;
  catchUpDays: number;
}

export interface ReminderInvoice {
  /**
   * Null or the invoice date itself when due on receipt: counted from the invoice date, and
   * never "due today" (the customer was just handed the bill).
   */
  dueDate: string | null;
  invoiceDate: string;
  /** Stages already emailed for this invoice. */
  sent: readonly ReminderKind[];
}

/** The latest stage reached, or null when none is due or it was already sent. */
export function reminderKindDue(
  invoice: ReminderInvoice,
  schedule: ReminderSchedule & { today: string },
): ReminderKind | null {
  const onReceipt = invoice.dueDate === null || invoice.dueDate === invoice.invoiceDate;
  const overdue = daysBetween(invoice.dueDate ?? invoice.invoiceDate, schedule.today);
  const reached = REMINDER_KINDS.filter((kind) => {
    const start = schedule.stages[kind];
    return overdue >= start && overdue <= start + schedule.catchUpDays;
  }).filter((kind) => !(kind === "DUE" && onReceipt));
  const latest = reached.at(-1);
  if (latest === undefined || invoice.sent.includes(latest)) return null;
  return latest;
}

/** How many days past due an invoice can still get a reminder: the job looks no further back. */
export function reminderLookbackDays(schedule: ReminderSchedule): number {
  return Math.max(...REMINDER_KINDS.map((kind) => schedule.stages[kind])) + schedule.catchUpDays;
}
