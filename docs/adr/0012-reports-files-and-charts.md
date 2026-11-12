# ADR 0012: Report files and charts without heavy libraries

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Phase 9 adds the dashboard (charts) and reports the shop hands to its CA: a sales register and an HSN summary as CSV and Excel, and later the GSTR-1 helper workbook. SPEC §7.1 named `exceljs` for Excel and BUILD_PLAN suggested `recharts` for charts. CLAUDE.md asks to prefer the platform or existing dependencies and to check that a new one is maintained.

- `exceljs` 4.4.0 was last released in 2023 and brings nine older dependencies (`archiver`, `unzipper`, `fast-csv`, `tmp` and others) that could trip CI's `pnpm audit --audit-level high`. Galla only writes files; it never reads Excel.
- `recharts` adds about 100 KB of client JavaScript to a page owners open on 4G phones, and SVG charts need a separate accessible version anyway.

## Decision

- **Excel:** `write-excel-file` 4.1 (MIT, updated June 2026, one dependency: `fflate`, write-only, several sheets, bold headers, widths, number formats, frozen header rows). `pnpm audit` reports nothing. Excel files are built in `src/server/reports/files.ts` from the pure report rows (Phase 9 plan, decision 3).
- **CSV:** written by hand in `src/server/domain/reports/csv.ts`: UTF-8 with a byte-order mark (Excel then shows ₹ and Hindi), CRLF, RFC 4180 quoting, and a leading apostrophe on any cell a spreadsheet would treat as a formula (`= + - @`, tab, CR), except plain numbers, so a customer named `=HYPERLINK(…)` stays text.
- **Charts:** drawn on the server as SVG and CSS bars, each with its numbers as text or a screen-reader table (decision 2). No chart library, no client JavaScript.
- **Money in files:** rupees with two decimals. Paise turn into a spreadsheet number only at the edge (`Number(formatRupees(paise))`) so Excel can sum the columns; every calculation before that is integer paise.
- **Labels in files are English**, like the PDFs (Phase 7 decision 7); filenames carry the period's dates, never a customer or business name.
- **Downloads** go through `tenantDownloadResponse` (session → membership → Zod query → service), and answer 404 for a non-member, a bad query or a role without `reports:export`, like the PDF routes.

## Consequences

- SPEC §7.1 and §4.10 now name `write-excel-file`. If a report ever needs to read Excel, or rich charts become worth the bytes, this decision is revisited.
- The GSTR-1 helper (PR 9c) uses the same file builders and the same library.
