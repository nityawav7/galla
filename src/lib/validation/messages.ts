/**
 * Zod schemas report errors as keys under `validation` in src/messages, so the same schema
 * gives English or Hindi messages in the form, and the server can send keys back as-is.
 */
export const VALIDATION_KEYS = [
  "nameRequired",
  "nameTooLong",
  "emailInvalid",
  "passwordLength",
  "codeFormat",
  "textTooLong",
  "legalNameRequired",
  "addressRequired",
  "cityRequired",
  "pincodeInvalid",
  "stateRequired",
  "phoneInvalid",
  "gstinRequired",
  "gstinFormat",
  "gstinState",
  "gstinChecksum",
  "gstinStateMismatch",
  "prefixInvalid",
  "prefixesSame",
  "upiInvalid",
] as const;

export type ValidationKey = (typeof VALIDATION_KEYS)[number];

export function isValidationKey(value: unknown): value is ValidationKey {
  return typeof value === "string" && (VALIDATION_KEYS as readonly string[]).includes(value);
}
