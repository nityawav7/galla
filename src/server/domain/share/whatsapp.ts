/**
 * WhatsApp click-to-chat sharing (SPEC F6): `https://wa.me/{phone}?text={encoded message}`, with a
 * message built from the business's template. No API and no account: the link opens WhatsApp
 * with the message typed, and the shop presses send.
 */

/** The words a template may use, written `{customer}` and so on. */
export const SHARE_PLACEHOLDERS = [
  "customer",
  "shop",
  "number",
  "amount",
  "dueDate",
  "link",
] as const;
export type SharePlaceholder = (typeof SHARE_PLACEHOLDERS)[number];
export type ShareValues = Record<SharePlaceholder, string>;

export const MAX_TEMPLATE_LENGTH = 1000;

/** Validation keys (under `validation` in src/messages). */
export type TemplateProblem =
  "templateRequired" | "templateTooLong" | "templateUnknownPlaceholder" | "templateNeedsLink";

const PLACEHOLDER = /\{([^{}\s]*)\}/g;

function isPlaceholder(name: string): name is SharePlaceholder {
  return (SHARE_PLACEHOLDERS as readonly string[]).includes(name);
}

/** Everything wrong with a template, empty when it can be saved. */
export function templateProblems(template: string): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  if (template.trim().length === 0) return ["templateRequired"];
  if ([...template.matchAll(PLACEHOLDER)].some(([, name = ""]) => !isPlaceholder(name))) {
    problems.push("templateUnknownPlaceholder");
  }
  if (!template.includes("{link}")) problems.push("templateNeedsLink");
  if (template.length > MAX_TEMPLATE_LENGTH) problems.push("templateTooLong");
  return problems;
}

/**
 * Fills in the placeholders. Plain text replacement only (no HTML, no expressions); anything in
 * braces that isn't a placeholder is left as typed.
 */
export function renderShareTemplate(template: string, values: ShareValues): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    isPlaceholder(name) ? values[name] : whole,
  );
}

/**
 * The number as wa.me wants it: digits only, with the country code and no "+" or leading zero
 * ("+919876543210" → "919876543210"). Phones are stored in E.164 (`phone.ts`); anything else
 * gives null.
 */
export function whatsAppNumber(e164: string | null): string | null {
  if (!e164 || !/^\+[1-9][0-9]{7,14}$/.test(e164)) return null;
  return e164.slice(1);
}

/**
 * The click-to-chat link. Without a number (a walk-in sale) WhatsApp asks whom to send it to.
 * `encodeURIComponent` escapes newlines, ₹, &, #, + and Hindi, so the message arrives exactly.
 */
export function waMeLink(number: string | null, text: string): string {
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
}
