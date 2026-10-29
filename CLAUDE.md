# CLAUDE.md — Galla

Galla is a production-grade, multi-tenant GST billing and udhaar app for small Indian shops: Next.js App Router, TypeScript, Drizzle, Neon Postgres, Better Auth, on Vercel.
**Read `SPEC.md` before starting any task.** `BUILD_PLAN.md` lists the phases. Work on one phase at a time.

## Commands
```bash
pnpm dev                 # local dev (needs: docker compose up -d)
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:unit           # Vitest (domain + services)
pnpm test:integration    # Vitest against real Postgres
pnpm test:e2e            # Playwright
pnpm db:generate         # drizzle-kit generate (after schema change)
pnpm db:migrate          # apply migrations
pnpm db:seed             # reference data + dev business
pnpm db:seed:demo        # deterministic demo business
pnpm check               # runs lint, format, typecheck, unit, integration — must pass before you say "done"
```

## Non-negotiable rules
1. **Money is integer paise (`bigint`), quantity is integer milli-units, tax rates are basis points.** No floats anywhere in money paths. Use the helpers in `src/server/domain/money.ts`.
2. **The server recomputes every total.** Never trust totals, tax or numbers sent by the client.
3. **Tenant isolation:** every query on a tenant table filters by `business_id` from a `TenantContext`. Use repos in `src/server/db/repos/`. Cross-tenant access only in `src/server/db/admin/`, and only for jobs and demo reset.
4. **Authorization is checked in services** using `src/server/authz/permissions.ts`, not only in the UI.
5. **Issued invoices are immutable.** Corrections go through cancellation or credit notes. Invoice numbers are assigned at issue inside a transaction with a row lock. Never reuse a number.
6. **Layering:** UI → server action or route handler (thin) → service → domain (pure) + repos. `src/server/domain/**` must not import Next.js, DB or network code.
7. **Validate every input with Zod** at the boundary. Share schemas between client forms and the server.
8. **Every DB change is a new drizzle migration.** Never edit a migration that is already merged. Add indexes for new FKs and query patterns.
9. **Never log PII** (phone, email, GSTIN, address, names). Log IDs. Never commit secrets. Add new env vars to `src/lib/env.ts` **and** `.env.example`.
10. **Mutations of financial data write an audit log row in the same transaction.**
11. **Dates:** business dates are in `Asia/Kolkata`. Store `timestamptz` in UTC and invoice dates as `date`. FY is Apr–Mar.
12. GST rates and thresholds are **data/config**, never magic numbers in logic.

## How to work
- **Plan first.** For any non-trivial task, write a short plan (files to touch, schema changes, tests) and wait for approval before coding.
- **Tests first for domain logic.** Write failing tests, then the code. Every bug fix gets a regression test.
- Keep changes small and focused, about one feature per PR. Use Conventional Commits (`feat(invoices): issue with gapless numbering`).
- Run `pnpm check` before declaring a task done, and report the results honestly. If something fails or is skipped, say so.
- Update `SPEC.md` if behaviour changes, add an ADR in `docs/adr/` for any significant decision, and update `README.md` for user-visible features.
- Don't add a dependency without stating why and checking it's maintained. Prefer the platform or existing deps.
- If a GST rule is unclear, **stop and ask**. Don't guess tax logic.

## Code style
- TypeScript `strict`, no `any` (use `unknown` and narrow). No non-null `!` assertions on external data.
- Prefer named exports, small pure functions, and early returns. Errors are typed classes from `src/lib/errors.ts`.
- React: Server Components by default; `"use client"` only where needed. Forms use react-hook-form + zodResolver + shadcn/ui.
- Accessible by default: labelled inputs, focus states, keyboard support. Mobile-first (test at 360 px).
- All user-facing strings go in `src/messages/{en,hi}.json` (next-intl). Format money with `en-IN` INR.

## Testing expectations
- Domain: 100% coverage, with property tests (fast-check) for GST invariants.
- Services: integration tests against real Postgres, including a **"different business → NotFound"** isolation test for every new service function.
- New user flows get or extend a Playwright e2e test.

## Glossary
CGST/SGST/UTGST (intra-state), IGST (inter-state), place of supply, GSTIN, HSN/SAC, UQC, FY, B2B/B2CL/B2CS, composition scheme (Bill of Supply), udhaar (credit ledger). Full definitions are in `SPEC.md` §12.
