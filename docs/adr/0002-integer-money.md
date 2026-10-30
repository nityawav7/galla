# ADR 0002: Integer money, one rounding rule, pure GST engine

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

An invoice that is off by one paisa from what a CA or the GST portal expects is a bug customers notice. JavaScript `number` is a binary float (0.1 + 0.2 ≠ 0.3) and is only exact for integers up to 2^53. Line amounts multiply quantity by price (and then by a rate), so intermediate values grow fast. The same calculation must run on the server (the source of truth) and in the invoice builder (live totals), and must be testable without a database.

## Decision

- **Units:** money is integer **paise**, quantity is integer **milli-units** (1.5 kg = 1500), tax rates are integer **basis points** (18% = 1800). Postgres stores money as `bigint`.
- **Type:** domain code uses JavaScript **`bigint`** for paise and milli-units. It is exact at any size and matches the DB column. At JSON boundaries (server actions, API, fixtures) amounts travel as **strings** because `JSON.stringify` cannot encode `bigint`. Rates stay `number` because they are small integers.
- **One rounding rule:** `divRoundHalfUp` in `src/server/domain/money.ts`, half away from zero (2.5 → 3, −2.5 → −3). No other code rounds. Each SPEC §4.5 step that divides rounds once:
  - gross = round(qty_milli × price / 1000)
  - tax-inclusive taxable = round(gross × 10000 / (10000 + rate_bp))
  - each intra-state half = round(taxable × rate_bp / 20000), so CGST always equals SGST/UTGST
  - IGST = round(taxable × rate_bp / 10000)
- **Totals are sums of line values**, never recomputed from aggregates. Round-off to the rupee is a separate line between −₹0.49 and +₹0.50.
- **Pure engine:** `src/server/domain/**` has no Next.js, DB, network, `process` or clock access (ESLint-enforced). Rates, state codes and thresholds are passed in or kept as reference data, never decided inside the calculation.
- **Decisions approved with the plan (30 Oct 2026):**
  1. Composition businesses cannot bill another state (blocked with a message).
  2. Unregistered businesses issue a plain "Invoice" with no GST (new document type `INVOICE`).
  3. Credit notes use their own series and prefix (default `CN`), which must differ from the invoice prefix.
  4. Discount is always before tax.
  5. GSTIN: only the regular taxpayer format in v1.
  6. Amount in words is English only in v1.
  7. An unregistered business billing another state is allowed with a warning, not blocked.

## Consequences

- Exact arithmetic everywhere, and property tests (fast-check) can assert invariants such as `cgst == sgst` and `|taxable + tax − gross| ≤ 1 paisa` for tax-inclusive lines (holds for any rate below 100%).
- Splitting intra-state tax into two separately rounded halves means an intra-state total can differ from the inter-state total by a paisa (e.g. 0.25% on ₹100: 2 × ₹0.13 vs ₹0.25). This is intended: the halves must be equal.
- `bigint` needs explicit conversion at boundaries (`BigInt(row.amount)`, `amount.toString()`), and it cannot be mixed with `number` by accident: TypeScript and the runtime both reject it.
- Drizzle `bigint` columns must use `mode: "bigint"` so values never pass through `number`.
