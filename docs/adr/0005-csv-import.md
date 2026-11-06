# ADR 0005: CSV import with a preview, a second check and an all-or-nothing commit

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Shops arrive with their products (and later customers) in Excel or another billing app. SPEC F2 asks for a CSV import with a preview, per-row errors with line numbers, a downloadable template, nothing partly committed, and 500 rows in under 10 seconds. Bad data here turns into wrong tax on invoices, so a half-imported file, or a row that silently "fixed itself", is worse than a refused file.

## Decision

- **Our own small CSV reader** (`src/server/domain/csv.ts`, about 80 lines), not a library. It reads RFC 4180 leniently: quoted cells with commas, newlines and `""`, CRLF/LF/CR, Excel's byte order mark, blank lines skipped. Each record keeps the line it starts on. It is pure and fully tested, with a fast-check round trip. A library like `papaparse` does much more (streaming, type guessing) than a 1,000-row upload needs, and would be one more dependency to watch.
- **Two steps, checked twice.** The browser reads the file and sends its text to `previewProductImport`, which validates every row and writes nothing. "Import" sends the same text to `importProducts`, which **validates it again** inside the transaction. The preview is never trusted, so a changed file or a product added meanwhile can't slip through.
- **All or nothing.** If any row has a problem, the import returns the report and saves nothing. Otherwise it inserts every row in one statement, plus one audit row per product, in one transaction. A unique violation from a race (someone adding the same SKU) rolls everything back and is reported as a conflict.
- **The same rules as the form.** Each row is turned into form values and checked with the shared Zod schema (`productSchema`). Errors are `validation.*` message keys, with the line and the column, so they show in English or Hindi.
- **Errors block, warnings don't.** Customers (Phase 5b) use the same flow. A phone another customer already has, in the file or in the shop, is shown as a warning and doesn't stop the import. A repeated or taken GSTIN, or a GSTIN whose state differs from the row's state, is an error.
- **Create only.** A row whose SKU an active product already has is an error. Updating products from a file is not supported (decision 5 of the Phase 5 plan).
- **Clear errors instead of guesses.**
  - A 3-, 5- or 7-digit HSN is reported as a likely lost leading zero (`hsnLeadingZero`) and never padded.
  - Rates must be active rows of `tax_rates`.
  - "yes/no/true/false/1/0" and blank are accepted for flags.
- **Limits:** 900 KB and 1,000 rows per file, checked in the browser and on the server. That keeps the request under Next's 1 MB server action limit.
- **Template:** built in the browser from the same column list (`PRODUCT_CSV_TEMPLATE`) and the same writer (`toCsv`), with a byte order mark so Excel reads ₹ and Hindi correctly.

## Consequences

- One code path validates a product, whether it comes from the form or a file.
- Very large catalogues need several files. That's acceptable for the target shops.
- Exports that people open in Excel (Phase 9) must neutralise cells starting with `= + - @` (CSV formula injection). Imports don't need it, because they never write user data back to a spreadsheet.
