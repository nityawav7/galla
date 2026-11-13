/** Renaming the product is a one-line change here (SPEC header). */
export const APP_NAME = "Galla";

/** The public source code (landing page and footer). */
export const SOURCE_URL = "https://github.com/nityawav7/galla";
/** Where people raise questions and data requests (Privacy page). */
export const ISSUES_URL = `${SOURCE_URL}/issues`;
/** The date the Privacy and Terms pages last changed. */
export const LEGAL_UPDATED = "2026-11-13";

export const APP_TAGLINE = "GST billing and udhaar for small shops";

/** The largest single payment, ₹10 crore (also a CHECK on `payments.amount_paise`). */
export const PAYMENT_MAX_PAISE = 10_000_000_000n;

/** How far back a payment may be dated (decision 13 of the Phase 8 plan). */
export const PAYMENT_BACKDATE_DAYS = 365;

/** The last day of each aging bucket: 0–30, 31–60, 61–90 and 90+ days past due (SPEC §4.9). */
export const AGING_LIMITS = [30, 60, 90] as const;

/** How many open invoices a WhatsApp payment reminder lists by name (decision 11). */
export const REMINDER_MAX_INVOICES = 5;

/** Ledger rows shown on the customer page before "Show earlier rows" (the statement has all). */
export const LEDGER_PAGE_ROWS = 100;

/** The longest custom report period, both ends counted (decision 10 of the Phase 9 plan). */
export const MAX_REPORT_DAYS = 366;

/** Email reminders: due today, then 1, 7 and 14 days overdue (decision 7 of the Phase 10 plan). */
export const REMINDER_STAGE_DAYS = { DUE: 0, D1: 1, D7: 7, D14: 14 } as const;

/** A stage whose day was missed (no run that day) still goes out up to this many days late. */
export const REMINDER_CATCH_UP_DAYS = 2;

/** The daily job reads businesses in batches of this size (decision 12). */
export const DAILY_JOB_BATCH_SIZE = 25;

/** The daily job starts no new business after this long; Hobby functions stop at 60 s. */
export const DAILY_JOB_BUDGET_MS = 45_000;

/** How many customers the owner digest lists (decision 10). */
export const OWNER_DIGEST_TOP = 10;
