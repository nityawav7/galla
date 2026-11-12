import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { printableDocument, type PrintableInput } from "@/server/domain/invoice/printable";
import { buildUpiPayLink } from "@/server/domain/upi";
import { renderDocumentPdf } from "@/server/pdf/render";
import { type DocumentPdfProps, type PdfFormat, pdfTranslator } from "@/server/pdf/types";

import { BILL_OF_SUPPLY, INTER_STATE, INTRA_STATE, UTGST } from "./samples";

/*
 * SPEC F5 acceptance: a snapshot of the PDF's text. Devanagari comes out of a PDF in visual glyph
 * order, so the Hindi samples are checked by eye (set PDF_OUT=dir to write the files) and here
 * only through their Latin parts. Key Rule 46 strings are also asserted one by one, so updating
 * a snapshot can never silently drop one.
 */

const t = pdfTranslator();

function props(input: PrintableInput, extra: Partial<DocumentPdfProps> = {}): DocumentPdfProps {
  return {
    doc: printableDocument(input),
    creditNote: null,
    payment: null,
    bank: null,
    cancelled: false,
    t,
    ...extra,
  };
}

const PAYMENT = {
  upiLink: buildUpiPayLink({
    vpa: "shop@oksbi",
    payeeName: "Sharma Hardware",
    amountPaise: 127400n,
    note: "SH/26-27/0001",
  }),
  vpa: "shop@oksbi",
  amount: "₹1,274.00",
};

const BANK = {
  accountName: "Sharma Hardware LLP",
  accountNumber: "50100012345678",
  ifsc: "HDFC0000123",
  bankName: "HDFC Bank",
};

async function pdfText(name: string, format: PdfFormat, documentProps: DocumentPdfProps) {
  const bytes = await renderDocumentPdf(format, documentProps);
  const out = process.env.PDF_OUT;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, `${name}-${format}.pdf`), bytes);
  }
  expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return { pages: pdf.numPages, text: text.replace(/[ \t]+/g, " ") };
}

const RULE_46 = [
  "Tax Invoice",
  "Sharma Hardware",
  "GSTIN: 27AAPFU0939F1ZV",
  "Ramesh Traders",
  "GSTIN: 29AABCU9603R1ZM",
  "SH/26-27/0001",
  "09-11-2026",
  "Karnataka (29)",
  "Tax payable on reverse charge",
  "2523",
  "IGST",
  "18%",
  "₹1,274.00",
  "Rupees One Thousand Two Hundred Seventy Four Only",
  "Authorised Signatory",
];

describe("invoice PDF", () => {
  for (const format of ["a4", "80mm"] as const) {
    it(`prints every Rule 46 field of fixture 11 (${format})`, async () => {
      const { text, pages } = await pdfText(
        "inter-state",
        format,
        props(INTER_STATE, { payment: PAYMENT, bank: format === "a4" ? BANK : null }),
      );
      expect(pages).toBe(1);
      for (const value of RULE_46) expect(text).toContain(value);
      expect(text).toContain("UPI ID: shop@oksbi");
      expect(text).toContain("Goods once sold are not taken back.");
      expect(text).toMatchSnapshot();
    });
  }

  it("splits CGST and SGST, prints the ship-to address and notes (A4)", async () => {
    const { text } = await pdfText("intra-state", "a4", props(INTRA_STATE));
    for (const value of [
      "CGST",
      "SGST",
      "SHIP TO",
      "Site 3, Gangapur Road",
      "Delivered by tempo",
    ]) {
      expect(text).toContain(value);
    }
    expect(text).not.toContain("IGST");
    expect(text).not.toContain("UPI ID:");
    expect(text).toMatchSnapshot();
  });

  it("prints UTGST and a walk-in customer, and stamps a cancelled invoice (80 mm)", async () => {
    const { text } = await pdfText("utgst-cancelled", "80mm", props(UTGST, { cancelled: true }));
    for (const value of ["UTGST", "Walk-in customer", "CANCELLED", "Chandigarh (04)"]) {
      expect(text).toContain(value);
    }
    expect(text).toMatchSnapshot();
  });

  it("prints a Bill of Supply without tax, with Hindi names (A4 and 80 mm)", async () => {
    for (const format of ["a4", "80mm"] as const) {
      const { text } = await pdfText("bill-of-supply", format, props(BILL_OF_SUPPLY));
      expect(text).toContain("Bill of Supply");
      expect(text).toContain("Composition taxable person, not eligible to collect tax on supplies");
      expect(text).toContain("Basmati rice");
      expect(text).not.toMatch(/CGST|SGST|IGST|Tax by rate/);
    }
  });

  // 60 lines over several pages: slow under coverage with every test file running at once.
  it("continues a long invoice on more pages, numbered", { timeout: 20_000 }, async () => {
    const lines = Array.from({ length: 60 }, (_, index) => ({
      ...INTRA_STATE.lines[0],
      description: `Item ${String(index + 1)}`,
    })) as PrintableInput["lines"];
    const { pages, text } = await pdfText("long", "a4", props({ ...INTRA_STATE, lines }));
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`Page 1 of ${String(pages)}`);
    expect(text).toContain("Item 60");
  });
});

describe("credit note PDF", () => {
  for (const format of ["a4", "80mm"] as const) {
    it(`prints the credit note title, its invoice and reason (${format})`, async () => {
      const { text } = await pdfText(
        "credit-note",
        format,
        props(
          { ...INTER_STATE, number: "CN/26-27/0001", lines: INTER_STATE.lines.slice(0, 1) },
          {
            creditNote: {
              invoiceNumber: "SH/26-27/0001",
              invoiceDate: "09-11-2026",
              reason: "Goods returned",
            },
          },
        ),
      );
      for (const value of [
        "Credit Note",
        "Credit note no.",
        "CN/26-27/0001",
        "SH/26-27/0001 dated 09-11-2026",
        "Goods returned",
        "Total credited",
      ]) {
        expect(text).toContain(value);
      }
      expect(text).not.toContain("Due date");
      expect(text).not.toContain("Terms and conditions");
      expect(text).toMatchSnapshot();
    });
  }
});
