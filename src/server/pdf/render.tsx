import { renderToBuffer } from "@react-pdf/renderer";

import { DocumentA4 } from "./document-a4";
import { DocumentThermal } from "./document-thermal";
import { registerPdfFonts } from "./fonts";
import { type DocumentPdfProps, type PdfFormat } from "./types";

/** Renders an invoice or credit note to PDF bytes, on demand (ADR 0008: nothing is stored). */
export async function renderDocumentPdf(
  format: PdfFormat,
  props: DocumentPdfProps,
): Promise<Uint8Array<ArrayBuffer>> {
  registerPdfFonts();
  const element = format === "80mm" ? <DocumentThermal {...props} /> : <DocumentA4 {...props} />;
  return new Uint8Array(await renderToBuffer(element));
}
