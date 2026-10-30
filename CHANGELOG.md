# Changelog

## Unreleased

- **Phase 2:** pure GST engine in `src/server/domain`: integer money and quantity helpers, GST state table, GSTIN validation with checksum, financial years in IST, line and invoice calculation (CGST/SGST/UTGST/IGST, tax-inclusive prices, discounts, round-off, composition), place of supply, document numbering and amount in words. Property tests, 10 hand-checked golden invoices, ADR 0002.
- **Phase 1:** project scaffold (Next.js 16, TypeScript strict, Tailwind + shadcn/ui), linting and commit hooks, typed env/logger/errors, Drizzle with Docker Postgres and Neon, `/api/health`, Vitest and Playwright smoke tests, CI with CodeQL, Dependabot and gitleaks.
