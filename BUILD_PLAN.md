# Galla — Build Plan (with Claude Code prompts)

Build in **phases**. Each phase is one or more PRs, ends with green CI, and is deployed. Never start a phase while the previous one is red.

## How to work with Claude Code (read once)
1. Put `SPEC.md`, `CLAUDE.md` and `BUILD_PLAN.md` in the repo root **before** the first prompt. Claude Code reads `CLAUDE.md` automatically.
2. For each phase, **paste the prompt** below. Ask it to **plan first**, review the plan, then let it implement.
3. **Read every diff.** You must be able to explain every file in an interview. If you don't understand something, ask Claude Code: "Explain this file and why it's designed this way."
4. Start a fresh conversation between phases so context stays clean. The docs carry the memory.
5. After each phase, commit, open a PR, let CI run, merge, and check the production deploy. Write two lines in `CHANGELOG.md`.
6. Keep a `docs/learning-log.md` with what you learned and what broke. Great material for interviews.

**Rough timeline:** 8–10 weeks at 2–3 hours a day. Phases 2 and 6 are the hardest, so give them extra time.

---

## Phase 0 — Accounts & local setup (you do this, ~1 day)
- [ ] Install **Node LTS** (via `nvm` or `fnm`), **pnpm**, **Docker Desktop**, **Git**, VS Code, and **Claude Code**.
- [ ] Create free accounts: **GitHub**, **Vercel** (sign in with GitHub), **Neon**, **Upstash**, **Sentry**, **PostHog**, **Resend**, and **UptimeRobot** or **Better Stack**.
- [ ] Optional but recommended: buy a cheap domain (₹100–800/yr). It looks professional, and Resend needs a verified domain to email anyone other than you.
- [ ] Create an empty **public** GitHub repo `galla` and add the three docs. Turn on branch protection for `main` (require PR plus status checks).

---

## Phase 1 — Scaffold, tooling, CI, first deploy
**Prompt:**
```
Read SPEC.md and CLAUDE.md. We are in Phase 1 of BUILD_PLAN.md: scaffold the project.
Plan first, then implement after I approve:
- Next.js (App Router, latest stable) + TypeScript strict + Tailwind + shadcn/ui, pnpm, .nvmrc with Node LTS.
- ESLint (incl. import ordering and no-restricted-imports so src/server/domain cannot import next/db), Prettier, lint-staged + husky pre-commit, commitlint (Conventional Commits).
- src/lib/env.ts using @t3-oss/env-nextjs with zod; .env.example.
- src/lib/logger.ts (pino, JSON, redacts PII keys), src/lib/errors.ts (typed domain errors).
- docker-compose.yml with Postgres 16; Drizzle ORM + drizzle-kit configured for local Postgres and Neon (serverless Pool driver).
- /api/health route: checks DB, returns {status, version, commitSha}.
- Vitest (unit + integration projects), Playwright with mobile and desktop projects, one smoke test each.
- GitHub Actions CI: install (cached), lint, format:check, typecheck, unit, integration (postgres service), build, gitleaks. Add Dependabot and CodeQL.
- `pnpm check` script that runs everything.
- Folder structure exactly as SPEC.md §7.3 (empty placeholders are fine).
- README skeleton and docs/adr/0001-nextjs-monolith-on-vercel.md.
Finally tell me the exact steps to connect Vercel + Neon (prod + preview branches) and set env vars.
```
**Done when:** CI is green; a Vercel prod URL shows a placeholder page; `/api/health` returns `ok` against Neon; PR previews deploy.

---

## Phase 2 — GST domain engine (pure, test-first). The most important phase.
**Prompt:**
```
Phase 2 of BUILD_PLAN.md. Implement src/server/domain per SPEC.md §4, test-first, with no DB or Next imports.
Plan first. Then:
1. money.ts: paise helpers, round-half-up, formatINR (en-IN).
2. states.ts: official GST state codes table + isUtWithoutLegislature. Flag anything you are unsure about for me to verify.
3. gstin.ts: format regex + mod-36 check character validation, stateFromGstin, panFromGstin.
4. fy.ts: financial year for a date in Asia/Kolkata ("26-27"), FY start/end.
5. gst/calc.ts: computeLine and computeInvoice exactly as §4.5 (tax-inclusive back-calc, discounts, intra (CGST+SGST or CGST+UTGST) vs inter (IGST), composition = no tax, optional round-off).
6. gst/placeOfSupply.ts: determine place of supply and tax type per §4.2.
7. numbering.ts: formatInvoiceNumber(prefix, fy, seq) with ≤16 chars and allowed-character validation.
8. amountInWords.ts: Indian system (lakh/crore), rupees and paise.
Tests: table tests + fast-check property tests for every invariant in §4.5, FY boundary tests, 100% coverage on src/server/domain. Create tests/fixtures/invoices with 10 hand-computed golden invoices and show me the calculations so I can verify them by hand.
```
**Done when:** 100% domain coverage; you have checked 3–5 golden fixtures by hand (ideally with an accountant friend); ADR `0002-integer-money.md` written.

---

## Phase 3 — Database schema, migrations, tenant-scoped repos
**Prompt:**
```
Phase 3. Implement the Drizzle schema from SPEC.md §7.4 with all constraints (CHECKs, uniques, FKs ON DELETE RESTRICT for financial tables) and indexes (§6.1, including pg_trgm).
- UUIDv7 ids, bigint paise, timestamptz, created_by.
- Reference tables (states, tax_rates, units) + scripts/seed.ts.
- src/server/authz/context.ts: TenantContext type. src/server/db/repos/*: every function takes ctx and filters by business_id.
- A transaction helper using the Neon serverless Pool.
- Integration tests: constraints reject bad data; a generic tenant-isolation test helper we will reuse for every service.
Generate the migration, show me the SQL, and write ADR 0003-tenant-isolation.md.
```
**Done when:** migrations apply cleanly on a fresh DB and on a Neon branch, and the isolation helper exists and is used.

---

## Phase 4 — Auth, businesses, onboarding, roles, invites
**Prompt:**
```
Phase 4 (SPEC F1 + §2.1). Integrate Better Auth with email+password, email OTP/magic link, Google, and the organization plugin mapped to our businesses table and roles OWNER/ACCOUNTANT/STAFF.
- permissions.ts with the exact matrix from SPEC §2.1, plus a `can(ctx, action)` helper and unit tests for every cell.
- Middleware/layout that resolves /b/[businessSlug] → TenantContext, 404 if not a member.
- 3-step onboarding with live invoice preview; business settings page (profile, GSTIN validated, UPI, prefix, scheme).
- Invite members by email (Resend; log the link in dev), 7-day expiry.
- Rate-limit auth routes with @upstash/ratelimit.
- E2E: sign up → onboard → reach dashboard; non-member gets 404.
```

---

## Phase 5 — Products & customers
**Prompt:**
```
Phase 5 (SPEC F2, F3). Products and customers: list (cursor pagination, trigram search), create/edit/archive, CSV import with preview + per-row errors + all-or-nothing commit + downloadable template. Customer GSTIN validation auto-fills state; duplicate detection on phone and GSTIN. Services enforce permissions and write audit logs. Integration tests incl. isolation; e2e for create + import. Mobile-first UI.
```

---

## Phase 6 — Invoices (builder, issue, cancel, credit notes). The heart of the app.
**Prompt:**
```
Phase 6 (SPEC F4, §4.5–4.8). Plan carefully first.
- Invoice builder page (mobile-first): customer picker with inline create, product search lines, one-off lines, qty (decimal), price, discount, live totals using the SAME domain calc functions on the client, tax type badge, place-of-supply override, autosave draft.
- invoice.service: createDraft, updateDraft, issue (transaction: lock number_sequences row FOR UPDATE, assign number, snapshot customer & lines, recompute totals server-side, set public_token, audit), cancel (owner only, reason), createCreditNote (own CN series, cannot exceed remaining balance).
- Issued invoices immutable (service + DB-level guard).
- Invoice list with filters (status incl. derived OVERDUE, date range, customer) and invoice detail page.
- Tests: concurrency test with 50 parallel issues → unique and gapless; immutability; isolation; golden fixtures through the full service; e2e of the 3-line invoice from SPEC F4 AC.
```

---

## Phase 7 — PDF, public link, UPI QR, WhatsApp share
**Prompt:**
```
Phase 7 (SPEC F5, F6). @react-pdf/renderer templates for A4 and 80mm thermal containing every Rule 46 field (§4.7), Noto Sans + Noto Sans Devanagari, amount in words, UPI QR. Route /api/pdf/[id] (auth) and public /i/[token] page (noindex, rate-limited, revocable token) with Download + Pay via UPI. WhatsApp share via wa.me with editable en/hi templates. Tests for UPI link building, wa.me encoding, phone normalisation, revoked-token 404, PDF text snapshot.
```

---

## Phase 8 — Payments, udhaar ledger, aging
**Prompt:**
```
Phase 8 (SPEC F7, §4.9). Record payments with allocation (manual or auto oldest-first), on-account credit, no over-allocation. Invoice status transitions to PARTIALLY_PAID/PAID. Customer ledger page with running balance, aging buckets, statement PDF, "Send reminder" WhatsApp button. Property test: ledger balance equals invoices − payments − credit notes on random data. Audit everything.
```

---

## Phase 9 — Dashboard & reports & GSTR-1 helper
**Prompt:**
```
Phase 9 (SPEC F8, §4.10). Dashboard cards and charts (recharts), role-aware. Reports with an IST date range: sales register (CSV/XLSX), HSN summary, GSTR-1 helper workbook (B2B, B2CL with threshold from config, B2CS, CDNR/CDNUR, HSN, Docs) via exceljs, with the "helper, not a filed return" label. Seed 10k invoices in an integration test and assert dashboard queries < 300ms p95; add indexes if needed and show me EXPLAIN ANALYZE for the slowest query.
```

---

## Phase 10 — Email & scheduled jobs
**Prompt:**
```
Phase 10 (SPEC F9). Resend + React Email templates (invoice, reminder, owner digest). /api/cron/daily protected by CRON_SECRET, idempotent via reminders_sent unique constraint, processes businesses in batches, logs a summary. vercel.json cron once per day (Hobby limit). Tests: running the job twice sends each reminder once; demo business never sends email.
```

---

## Phase 11 — Production hardening
**Prompt:**
```
Phase 11 (SPEC §6). Hardening pass:
- Security headers + strict CSP with nonces; review every route/action for authz + zod + rate limiting; file upload checks (Vercel Blob, MIME/size, re-encode).
- Sentry (client, server, edge) with source maps and release = commit SHA; PostHog with no PII; pino requestId.
- Audit log viewer page with filters.
- Accessibility: axe checks in Playwright on key pages; fix all serious issues. Lighthouse mobile ≥ 90.
- Nightly backup GitHub Action: pg_dump → age-encrypt → upload to R2/B2; docs/restore.md; test a restore into a Neon branch.
- docs/runbook.md and docs/architecture.md (with Mermaid diagrams).
- k6 load script for invoice creation; record p95 in README.
Give me a checklist of everything verified and anything not done.
```

---

## Phase 12 — Demo mode, landing page, launch
**Prompt:**
```
Phase 12 (SPEC F12, §9, §10). Deterministic scripts/seed-demo.ts (fixed faker seed, en_IN, curated HSN product lists, 6 months of realistic invoices/payments/credit notes). "Try demo as Owner / as Staff" buttons; demo banner; email suppressed; stricter rate limits; /api/cron/demo-reset daily. Landing page (problem, 3 features, screenshots, demo button, GitHub link), Privacy and Terms pages, footer disclaimer. Final README with demo link, video placeholder, architecture diagram, decisions, metrics, how to run.
```
**Then you:** record a 2-minute demo video, add UptimeRobot monitoring on `/api/health`, and post the project on LinkedIn.

---

## Phase 13 — Real users (the part that gets you hired)
- Approach 20–30 shops, freelancers and home businesses (see the earlier outreach plan). Onboard 3–5 in person.
- Track: invoices per week, time to issue (PostHog), reminders sent, money recovered.
- Ship two or three improvements from their feedback, and note each one in the changelog with "requested by users".
- Write a **case study** section in the README using only real numbers.

## Later tracks (from SPEC §11)
- **Data:** dbt models over a read replica or export, with a Metabase dashboard of the cohort and retention of demo businesses.
- **AI:** supplier-bill extraction with a human review screen, plus an evaluation set measuring field accuracy.
- **Payments:** Razorpay test-mode payment links + verified webhooks.
