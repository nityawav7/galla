/**
 * GST thresholds used by the invoice rules (CLAUDE.md rule 12: data or config, never inline).
 * Verify against current CBIC notifications before launch (SPEC §4 disclaimer).
 */

/**
 * Rule 46: for an unregistered recipient of an invoice worth this much or more, the invoice
 * must carry the recipient's name, address and state. ₹50,000, in paise. Compared with the
 * invoice total until a CA confirms which value (docs/golden-fixtures.md, question 4).
 */
export const RECIPIENT_DETAILS_THRESHOLD_PAISE = 5_000_000n;

/**
 * GSTR-1 B2CL: an inter-state invoice to an unregistered buyer above this value (incl. tax) is
 * reported invoice by invoice; below it, in B2CS. ₹1,00,000 since 1 Aug 2024 (was ₹2,50,000),
 * in paise. Verify (docs/golden-fixtures.md, CA question 10).
 */
export const B2CL_THRESHOLD_PAISE = 10_000_000n;
