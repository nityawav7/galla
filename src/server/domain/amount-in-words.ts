/**
 * Amount in words in the Indian numbering system (thousand, lakh, crore), as
 * printed on invoices (SPEC §4.7): "Rupees One Lakh and Fifty Paise Only".
 */

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** Callers only pass indexes inside the table (0–19 for ONES, 2–9 for TENS). */
function word(table: readonly string[], index: number): string {
  return String(table[index]);
}

const CRORE = 10_000_000n;
const LAKH = 100_000n;
const THOUSAND = 1_000n;

/** 1–99 */
function belowHundred(n: number): string {
  if (n < 20) return word(ONES, n);
  const tens = word(TENS, Math.floor(n / 10));
  return n % 10 === 0 ? tens : `${tens} ${word(ONES, n % 10)}`;
}

/** 1–999 */
function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${word(ONES, hundreds)} Hundred`);
  if (rest > 0) parts.push(belowHundred(rest));
  return parts.join(" ");
}

/** Positive integers; crores above 99 are themselves spelled in the Indian system. */
function indianWords(n: bigint): string {
  const parts: string[] = [];
  const crores = n / CRORE;
  const lakhs = Number((n % CRORE) / LAKH);
  const thousands = Number((n % LAKH) / THOUSAND);
  const rest = Number(n % THOUSAND);
  if (crores > 0n) parts.push(`${indianWords(crores)} Crore`);
  if (lakhs > 0) parts.push(`${belowHundred(lakhs)} Lakh`);
  if (thousands > 0) parts.push(`${belowHundred(thousands)} Thousand`);
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(" ");
}

export function amountInWords(paise: bigint): string {
  if (paise < 0n) throw new RangeError("Amount in words needs a non-negative amount");
  const rupees = paise / 100n;
  const remainder = Number(paise % 100n);
  const rupeeWords = rupees === 0n ? "Zero" : indianWords(rupees);
  const paiseWords =
    remainder === 0 ? "" : ` and ${belowHundred(remainder)} ${remainder === 1 ? "Paisa" : "Paise"}`;
  return `Rupees ${rupeeWords}${paiseWords} Only`;
}
