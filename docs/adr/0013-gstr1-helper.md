# ADR 0013: The GSTR-1 helper workbook

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

SPEC §4.10 asks for an Excel workbook a shop can hand to its CA for GSTR-1: invoices and credit notes for a month or quarter, sorted into the tables of the GST offline tool. Galla is not a GST Suvidha Provider and files nothing; a wrong table costs the CA time, and a wrong rule could mislead. CLAUDE.md says not to guess tax logic. The owner has no CA to ask yet, so the unclear points are recorded as open questions and the workbook says, on its first sheet, that it is a helper.

## Decision

- **Pure mapping** in `src/server/domain/gstr1/build.ts`, property-tested: every rupee of taxable value lands in exactly one table, and the HSN tables add up to the same net amount. The 10 golden invoices of a regular business go through it too.
- **Tables** (decisions 12–17 of the Phase 9 plan):
  - **b2b:** recipient has a GSTIN (from the invoice's snapshot); one row per invoice per rate.
  - **b2cl:** no GSTIN, inter-state, invoice value incl. tax strictly above `B2CL_THRESHOLD_PAISE` (₹1,00,000, `src/lib/gst-config.ts`).
  - **b2cs:** every other sale without a GSTIN, summed by place of supply and rate (type OE). Credit notes on such sales reduce it.
  - **cdnr:** credit notes to a GSTIN. **cdnur:** credit notes against B2CL invoices (UR type B2CL).
  - **exemp:** 0% lines as nil-rated, split by inter/intra-state and registered/unregistered. Galla can't yet tell nil-rated, exempt and non-GST apart.
  - **hsn(b2b)** and **hsn(b2c):** by HSN, UQC ("KGS-KILOGRAMS") and rate, credit notes subtracted, lines without HSN grouped and counted.
  - **docs:** per series, the first and last number in the period, the total and the cancelled count.
  - Cancelled invoices appear only in docs. Reverse charge "N", no e-commerce operator, no cess (Galla has none of these).
- **Only regular businesses** get it (composition dealers and unregistered shops file other returns or none). The page explains why when it is hidden.
- **Periods:** a month or a financial quarter (QRMP), by invoice and note date.
- **Workbook:** `write-excel-file` (ADR 0012); sheet names and column headers copy the offline tool's template, dates as `02-Nov-2026`, places as `29-Karnataka`, rates as percentages, amounts in rupees. A "Read me" sheet comes first: "GSTR-1 helper for your CA — not a filed return", the business, GSTIN, period, when it was made, and a check-before-filing list (lines without HSN, the B2CL threshold used, the nil-rated assumption, how credit notes were placed).

## Consequences

- The CA still checks and files; Galla prepares, never submits.
- Open CA questions 10–14 in `docs/golden-fixtures.md` cover the B2CL threshold, unregistered credit notes, 0% supplies, the HSN table format and cancelled documents. When one is answered, the mapping and its tests change in one place.
- If GSTN changes the template, the headers live in `src/server/reports/gstr1-workbook.ts`.
