/** Paper sizes a document can be printed on (SPEC F5). Shared with the browser, so no react-pdf here. */
export const PDF_FORMATS = ["a4", "80mm"] as const;
export type PdfFormat = (typeof PDF_FORMATS)[number];
