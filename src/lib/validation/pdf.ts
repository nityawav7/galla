import { z } from "zod";

import { PDF_FORMATS } from "@/server/pdf/formats";

/** `?format=a4|80mm&download=1` on the PDF routes. Anything else is refused (CLAUDE.md rule 7). */
export const pdfQuerySchema = z.strictObject({
  format: z.enum(PDF_FORMATS).default("a4"),
  download: z.literal("1").optional(),
});

export type PdfQuery = z.output<typeof pdfQuerySchema>;
