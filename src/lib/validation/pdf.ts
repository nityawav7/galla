import { z } from "zod";

import { LEDGER_PERIODS } from "@/server/domain/ledger/period";
import { PDF_FORMATS } from "@/server/pdf/formats";

/** `?format=a4|80mm&download=1` on the PDF routes. Anything else is refused (CLAUDE.md rule 7). */
export const pdfQuerySchema = z.strictObject({
  format: z.enum(PDF_FORMATS).default("a4"),
  download: z.literal("1").optional(),
});

export type PdfQuery = z.output<typeof pdfQuerySchema>;

/** `?period=fy|lastFy|all&download=1` on the customer statement (A4 only, decision 10). */
export const statementQuerySchema = z.strictObject({
  period: z.enum(LEDGER_PERIODS).default("fy"),
  download: z.literal("1").optional(),
});
