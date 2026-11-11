/** Renaming the product is a one-line change here (SPEC header). */
export const APP_NAME = "Galla";

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
