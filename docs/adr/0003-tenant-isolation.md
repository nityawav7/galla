# ADR 0003: Tenant isolation in the repo layer, backed by composite foreign keys

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Every shop's invoices, customers and payments live in one Postgres database. One shop seeing another's data, even a single row behind a guessed URL, would be the worst bug Galla could ship. SPEC §6.2 requires a `business_id` on every tenant table, repos that require a `TenantContext`, and an isolation test for every service. Phase 3 has no login yet (Better Auth arrives in Phase 4), so the isolation design must not depend on it.

## Decision

- **`TenantContext { userId, businessId, role }`** (`src/server/authz/context.ts`) is required by every tenant repo function. Repos never accept a `businessId` from callers: inserts stamp `business_id` and `created_by` from the context, and updates re-assert `business_id` so a stray field in a patch cannot move a row to another business.
- **One WHERE helper:** every tenant query filters through `tenantScope(ctx, table, …conditions)`, which always adds `business_id = ctx.businessId` and fails closed (`false`) if it ever receives nothing.
- **Not found, not forbidden:** another business's record is indistinguishable from a missing one. Repos return `undefined` or an empty list; services turn that into `NotFoundError` (404), so ids from other businesses reveal nothing.
- **Queries live only in `src/server/db/**`.** ESLint forbids importing `drizzle-orm`, the driver packages or `@/server/db/schema` anywhere else in `src/`. Services call repos. Cross-tenant code is limited to `src/server/db/admin/**`, importable only from jobs (unchanged from Phase 1).
- **Composite foreign keys inside a tenant.** Each referenced tenant table has `UNIQUE (business_id, id)`, and children reference `(business_id, x_id)`. An invoice therefore cannot point at another business's customer, nor a line at another business's invoice or product, even if a repo has a bug. The composite indexes also serve as the foreign-key indexes.
- **The database checks money too:** CHECK constraints enforce non-negative amounts, the CGST = SGST/UTGST split, IGST only for inter-state, `line_total = taxable + taxes`, `grand_total = taxable + taxes + round_off`, round-off between −49 and +50 paise, numbers only once issued, and paid ≤ total. Financial foreign keys are `ON DELETE RESTRICT`.
- **A reusable test helper**, `expectTenantIsolation` / `itIsolatesTenants` in `tests/integration/support/tenant-isolation.ts`, creates two businesses, writes data as the owner, runs the operation as the other business, and passes only on `NotFoundError` or a result that contains none of the owner's ids. For writes, a `verify` step checks the owner's row is unchanged. Every repo function uses it now; every service function must from Phase 5 on.

Decisions approved with the Phase 3 plan (2 Nov 2026):

1. Better Auth's tables come in Phase 4. `businesses` is shaped so its organization plugin can use it (`slug`, `metadata`, `created_at`; `name` → `legal_name`, `logo` → `logo_url`). `created_by` / `actor_user_id` are uuids without a foreign key until then.
2. UUIDv7 ids are generated in the app (`uuid` package). Postgres only has `uuidv7()` from version 18.
3. Status and type columns are `text` with a CHECK, which is easier to extend than a Postgres enum.
4. Isolation is enforced in the app plus constraints; Postgres row-level security is a Phase 11 hardening candidate.
5. A customer GSTIN is unique per business among active customers; a repeated phone number is only a warning.
6. Products and customers are archived (`archived_at`), and uniqueness ignores archived rows.
7. Reference data is seeded by an idempotent `db:seed:reference` in every Vercel build; the dev business is local-only.
8. Integration tests create their own businesses with unique slugs instead of truncating tables.

## Consequences

- A missing tenant filter is a visible omission (no `tenantScope`) and a failing isolation test, rather than a silent leak. A repo bug that writes across tenants is still stopped by the composite foreign keys.
- Every tenant table carries an extra `UNIQUE (business_id, id)` index. That is a small write cost for a strong guarantee.
- Repos take the executor (`db` or a transaction `tx`) as their first argument. Callers must pass `tx` inside `withTransaction`, or the call runs outside the transaction. Code review and the audit-log tests (change and audit row roll back together) guard this.
- Isolation depends on code paths using repos. RLS would add a database-level check for raw SQL too, at the cost of setting a session variable per transaction with Neon's pooler. Revisit in Phase 11.
