import { createTranslator } from "next-intl";

import messages from "@/messages/en.json";
import { type PrintableDocument } from "@/server/domain/invoice/printable";

export { PDF_FORMATS, type PdfFormat } from "./formats";

/**
 * PDF labels. English in v1 (decision 7 of the Phase 7 plan): the app has no business language
 * setting yet. Hindi names and items still print, with the Devanagari font.
 */
export function pdfTranslator() {
  return createTranslator({ locale: "en", messages, namespace: "pdf" });
}

export type PdfTranslator = ReturnType<typeof pdfTranslator>;

/** Where the customer can pay: read live from the business settings (decision 4). */
export interface PdfPayment {
  /** The `upi://pay` link, drawn as a QR code. */
  upiLink: string;
  vpa: string;
  /** The balance due, formatted. */
  amount: string;
}

export interface PdfBank {
  accountName: string | null;
  accountNumber: string;
  ifsc: string | null;
  bankName: string | null;
}

export interface PdfCreditNote {
  invoiceNumber: string;
  invoiceDate: string;
  reason: string;
}

export interface DocumentPdfProps {
  doc: PrintableDocument;
  /** Set for a credit note; its title, number label and total label differ. */
  creditNote: PdfCreditNote | null;
  /** Null when there is no UPI ID, nothing is due, or the document is cancelled. */
  payment: PdfPayment | null;
  bank: PdfBank | null;
  cancelled: boolean;
  /** The demo shop's documents say they are samples, not real bills (SPEC F12). */
  sample: boolean;
  t: PdfTranslator;
}
