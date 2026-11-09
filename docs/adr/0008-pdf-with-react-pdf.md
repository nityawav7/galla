# ADR 0008: Invoice PDFs with react-pdf, rendered on demand

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Shops need every issued invoice and credit note as a PDF: A4 to email or print, and an 80 mm slip for counter thermal printers (SPEC F5). The PDF must carry every Rule 46 field (§4.7), print ₹ and Hindi names correctly, and render inside a Vercel function on the Hobby plan (no long-lived server, limited function size and time).

Options:

1. **Headless Chrome** (`puppeteer` with `@sparticuz/chromium`) printing an HTML page. Reuses the web invoice, but the browser is 50+ MB, cold starts take seconds, and it needs its own font setup anyway.
2. **pdfkit or pdf-lib directly.** Small and fast, but every line, column and page break is positioned by hand.
3. **`@react-pdf/renderer`.** React components with flexbox layout, rendered to PDF in plain Node by pdfkit and fontkit. No browser. MIT, actively maintained (4.9.0, Aug 2026), React 19 supported. It is the choice named in SPEC §7.1.

## Decision

- **react-pdf 4.9** renders PDFs in a Node route handler (`serverExternalPackages` keeps it out of the bundle).
- **Fonts:** Noto Sans and Noto Sans Devanagari (regular and bold, OFL), committed in `src/server/pdf/fonts/` with their SHA-256 and traced into the PDF routes by `outputFileTracingIncludes`. Styles use `fontFamily: ["NotoSans", "NotoSansDevanagari"]`, so each character falls back to Devanagari when Latin lacks it and one line can mix both scripts.
- **Spike first:** before any template, a test page checked that react-pdf shapes Devanagari correctly (श्री, हार्डवेयर, क्षत्रिय, प्रिंटर, द्वार, ट्रक: conjuncts, reph and pre-base vowel signs), prints ₹, falls back between font families and sizes an 80 mm page to its content. All passed.
- **One printable model, two layouts.** `printableDocument()` (pure, in `src/server/domain/invoice/printable.ts`) turns a document's snapshots into display strings: parties, Rule 46 rows, lines with each tax's rate and amount, tax by rate, totals and amount in words. The A4 and 80 mm templates only lay that out, and the model is unit-tested without a PDF.
- **Snapshots only for tax content**; payment details (UPI ID, bank account) are read live, so customers always pay the current account (Phase 7 plan, decision 4). The UPI QR asks for the balance due and is left out when nothing is due or the invoice is cancelled.
- **UPI QR with `uqr`** (zero dependencies), drawn as one vector path: crisp on any printer, no canvas or image.
- **Rendered on demand, never stored.** A warm render takes about half a second; storing them would add a blob store, invalidation when a payment changes the QR amount, and more personal data at rest.
- **Labels in English for v1** (decision 7). The UI has no business language setting yet; Hindi item and customer names print regardless.
- Routes live under the business, `/b/{slug}/invoices/{id}/pdf` and `/b/{slug}/credit-notes/{id}/pdf` (`?format=a4|80mm`, `&download=1` to save), so the proxy and membership check that guard every `/b/{slug}` page guard them too (decision 10).

## Consequences

- Text copied out of a PDF comes out in visual glyph order for Devanagari (normal for PDFs); the PDF snapshot tests therefore compare the Latin text and the Hindi output is checked by eye.
- Characters missing from both fonts (for example arrows or emoji) print as blanks. Labels avoid them; a typed emoji in an item name would not print.
- In react-pdf, a block marked "don't split" breaks an auto-height page, so the 80 mm slip never uses it.
- Logos and signatures are not drawn yet (decision 14): fetching an arbitrary image URL during rendering is a server-side request risk. They come with checked uploads.
- About 1.2 MB of fonts ship with the PDF routes; each PDF embeds only the glyphs it uses.
