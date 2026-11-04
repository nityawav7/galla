# Changelog

## Unreleased

- **Phase 4a:** sign-in with Better Auth: email and password, 6-digit email codes (sign-in, verification, password reset) and optional Google, on our own tables (migration `0002_auth`, UUIDv7 ids). Pages for sign-in, sign-up and password reset in English and Hindi, a sign-in check on app pages, the SPEC §2.1 permission matrix in `permissions.ts`, Upstash rate limits on auth (5/min/IP), Resend email, ADR 0004.
- **Phase 3:** database schema for businesses, products, customers, invoices, credit notes, payments, reminders and the audit log, with CHECK constraints for GST totals, composite foreign keys that keep every link inside one business, and trigram search indexes. Tenant-scoped repos with `TenantContext`, `withTransaction`, idempotent reference and dev seeds (`pnpm db:seed`, `pnpm db:seed:reference`, run in every Vercel build), a reusable tenant-isolation test helper, ADR 0003.
- **Phase 2:** pure GST engine in `src/server/domain`: integer money and quantity helpers, GST state table, GSTIN validation with checksum, financial years in IST, line and invoice calculation (CGST/SGST/UTGST/IGST, tax-inclusive prices, discounts, round-off, composition), place of supply, document numbering and amount in words. Property tests, 10 hand-checked golden invoices, ADR 0002.
- **Phase 1:** project scaffold (Next.js 16, TypeScript strict, Tailwind + shadcn/ui), linting and commit hooks, typed env/logger/errors, Drizzle with Docker Postgres and Neon, `/api/health`, Vitest and Playwright smoke tests, CI with CodeQL, Dependabot and gitleaks.
