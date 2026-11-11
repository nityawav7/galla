import { addDays } from "../fy";

/*
 * SPEC §1.2: "overdue amount recovered within 14 days of a reminder". Each WhatsApp reminder
 * (`customer.reminderShared`, Phase 8c) recorded what was overdue then. A payment by that
 * customer within 14 days counts towards the latest reminder before it, up to what was overdue;
 * money beyond that, or paid later, is not credited to the reminder.
 */

export const RECOVERY_WINDOW_DAYS = 14;

export interface ReminderSent {
  customerId: string;
  /** The day it was sent, in Asia/Kolkata. */
  date: string;
  overduePaise: bigint;
}

export interface PaymentMade {
  customerId: string;
  date: string;
  amountPaise: bigint;
}

export interface Recovery {
  reminders: number;
  /** Σ overdue when the reminders went out. */
  remindedPaise: bigint;
  recoveredPaise: bigint;
}

export function recoveredAfterReminders(
  reminders: readonly ReminderSent[],
  payments: readonly PaymentMade[],
  windowDays = RECOVERY_WINDOW_DAYS,
): Recovery {
  // What each reminder can still be credited with.
  const open = reminders.map((reminder) => ({ ...reminder, leftPaise: reminder.overduePaise }));
  let recovered = 0n;
  const ordered = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  for (const payment of ordered) {
    let latest: (typeof open)[number] | null = null;
    for (const reminder of open) {
      if (reminder.customerId !== payment.customerId || reminder.date > payment.date) continue;
      if (addDays(reminder.date, windowDays) < payment.date) continue;
      if (latest === null || reminder.date >= latest.date) latest = reminder;
    }
    if (latest === null) continue;
    const credited =
      payment.amountPaise < latest.leftPaise ? payment.amountPaise : latest.leftPaise;
    latest.leftPaise -= credited;
    recovered += credited;
  }
  return {
    reminders: reminders.length,
    remindedPaise: reminders.reduce((sum, reminder) => sum + reminder.overduePaise, 0n),
    recoveredPaise: recovered,
  };
}
