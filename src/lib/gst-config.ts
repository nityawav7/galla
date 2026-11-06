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
