# Galla — Product & Technical Specification

> **Working name:** "Galla" (the cash box on a shop counter). Before you commit to it, check GitHub, Vercel, the Play Store and Google. "Munim" and "Raseed" are already existing billing products, so avoid those. The app name lives in one config constant (`APP_NAME`), so renaming later is a one-line change.
>
> **Status:** v1 specification. Owner: Nitya. Last updated: 30 Oct 2026.

---

## 0. How to use this document

This is the **single source of truth** for what we are building and why. Claude Code should read it before starting any phase (see `BUILD_PLAN.md`). The engineering rules it must follow every time are in `CLAUDE.md`.

When this spec and the code disagree, either the code is wrong or the spec must be updated in the same PR. Never let them drift.

---

## 1. Problem statement

Small GST-registered shops in India (kirana, hardware, stationery, garments, electricals, home businesses) still bill with **carbon-copy bill books and a calculator**, or send rough bills on WhatsApp. This causes:

1. **Tax mistakes.** Wrong GST rate, wrong CGST/SGST vs IGST split, and arithmetic errors.
2. **Lost udhaar (credit).** Who owes what lives in a diary. Payments get forgotten and chasing them is awkward.
3. **Month-end chaos.** The CA needs a sales summary for GSTR-1. Someone re-types a pile of paper bills.
4. **No visibility.** The owner doesn't know monthly sales, top products, or how much money is stuck.

**Galla** lets a shop owner create a GST-correct invoice in **under 60 seconds** on a phone, share it on **WhatsApp with a UPI payment QR**, track **udhaar** automatically, and hand the CA a **one-click GST sales export**.

### 1.1 Positioning (why not just Vyapar or Zoho?)
Existing apps are feature-heavy. Galla focuses on three things only:
- **WhatsApp first:** share, pay, remind.
- **Built for the CA handoff:** clean exports, zero re-typing.
- **Very simple, mobile-first UI**, with Hindi as well as English.

### 1.2 Success metrics (measured in the product)
| Metric | Target |
|---|---|
| Median time from "New invoice" to "Issued" | < 60 s |
| GST calculation errors | 0 (enforced by tests) |
| Share of issued invoices shared via WhatsApp or link | > 50% |
| Overdue amount recovered within 14 days of a reminder | tracked, reported in dashboard |
| Weekly active businesses (real users) | 3–5 in first 2 months |

---

## 2. Users & personas

| Persona | Description | Main jobs |
|---|---|---|
| **Owner** (Ramesh, 45, hardware shop, Tier-2 city) | GST-registered, uses WhatsApp daily, not an accountant | Bill customers, see who owes money, send data to CA |
| **Staff** (counter helper) | Makes bills when the owner is busy | Create invoices and customers, record cash or UPI received |
| **Accountant/CA** | External, monthly | View all invoices, download GST exports, read-only |
| **End customer** (buyer) | Receives the invoice | Open invoice link, download PDF, pay via UPI |
| **Recruiter** (portfolio visitor) | Spends 60 seconds on the project | Click "Try demo", see a realistic, working product |

### 2.1 Roles & permissions (RBAC)

| Action | OWNER | ACCOUNTANT | STAFF |
|---|:-:|:-:|:-:|
| Manage business settings, members, delete business | ✅ | ❌ | ❌ |
| Create/edit products & customers | ✅ | ❌ | ✅ |
| Create draft & issue invoices | ✅ | ❌ | ✅ |
| Cancel invoice / issue credit note | ✅ | ❌ | ❌ |
| Record payments | ✅ | ✅ | ✅ |
| View all invoices, ledger, dashboard | ✅ | ✅ | ✅ (dashboard totals hidden) |
| Download GST exports & reports | ✅ | ✅ | ❌ |
| View audit log | ✅ | ✅ | ❌ |

Permissions are defined **once** in `src/server/authz/permissions.ts` and checked in **every service function**, not only in the UI.

---

## 3. Scope

### 3.1 In scope for v1
- Sign up, log in, create a business (tenant), invite members by email with roles
- Business profile: GSTIN, address, state, logo, bank details, UPI ID, invoice prefix, terms, signature
- Products and services with HSN/SAC, unit, price, GST rate, tax-inclusive flag; CSV import
- Customers with GSTIN validation, state, addresses, opening balance, credit days; CSV import
- Invoice builder (draft → issue), automatic GST calculation, gapless invoice numbering per financial year
- Tax Invoice (regular scheme), Bill of Supply (composition scheme), and a plain Invoice with no GST (unregistered business)
- Cancel invoice (with reason) and credit notes
- PDF invoice (A4 and 80 mm thermal), public share link, UPI QR, WhatsApp share
- Payments (full or partial, cash/UPI/bank/card/cheque), customer ledger (udhaar), receivables aging
- Dashboard: sales, tax collected, receivables, top products, top debtors
- Reports: sales register, GSTR-1 helper export (Excel), HSN summary
- Email delivery of invoices; daily reminder and owner digest jobs
- Audit log, rate limiting, error monitoring, product analytics, backups
- English and Hindi UI; Indian number formatting (₹1,23,456.00)
- Demo mode: "Try demo" with realistic seeded data, reset nightly

### 3.2 Out of scope for v1 (design so these can be added later)
- E-invoicing (IRN/QR from the IRP). This is mandatory only above a turnover threshold (currently ₹5 crore AATO, verify), and is not the target user.
- E-way bills, purchase bills, input tax credit, inventory/stock, GST return filing via GSP APIs
- Automated WhatsApp messages (needs the paid WhatsApp Business Platform). v1 uses click-to-chat links. Keep a `NotificationChannel` interface so it can be added.
- Real payment gateway (Razorpay). v1 uses UPI deep links plus manual "mark paid". Razorpay test mode is a v2 item.
- Offline mode, native apps, multi-currency, export invoices (LUT/zero-rated), cess

---

## 4. GST domain rules (the core of the product)

> ⚠️ **Compliance disclaimer:** Galla helps with billing. It is not a substitute for a CA. Tax rules and rates change, so verify every rule below against current CBIC notifications and the GST portal before launch, and show a disclaimer in the app. Rates and thresholds must be **data (DB or config)**, never hard-coded in logic.

### 4.1 GSTIN
- 15 characters: `SS` state code (2 digits) + PAN (10) + entity number (1) + `Z` (default) + check character (1).
- Validate the regex **and the check character** (mod-36 checksum algorithm). Write unit tests using known-valid GSTINs and mutated invalid ones.
- Derive the customer's state from the first two digits. Block a mismatch between the GSTIN state and the chosen state (with an override plus a warning).
- v1 accepts only the regular taxpayer format (14th character `Z`) with an active state code. Other formats (TDS/TCS, UN bodies, non-resident) get a clear "not supported yet" message.

### 4.2 States & place of supply
- Seed the official **GST state code list** (01 Jammu & Kashmir … 37 Andhra Pradesh, 38 Ladakh, 97 Other Territory). Verify it against the GST portal and store it in a `states` reference table with a `is_ut_without_legislature` flag.
- **Place of supply (v1 rule for goods):** the customer's state (shipping state if one is given, otherwise billing state). If the customer is unregistered and has no state, use the business's state. The user can override it per invoice.
- **Intra-state** (business state = place of supply): **CGST + SGST**, or **CGST + UTGST** for UTs without a legislature.
- **Inter-state:** **IGST**.
- UTGST applies in 04 Chandigarh, 26 Dadra and Nagar Haveli and Daman and Diu, 31 Lakshadweep, 35 Andaman and Nicobar Islands and 38 Ladakh. 01 Jammu and Kashmir, 07 Delhi and 34 Puducherry have legislatures and charge SGST. Legacy codes 25 (Daman and Diu) and 28 (undivided Andhra Pradesh) are kept **inactive** so old data renders. 97 Other Territory is treated as UTGST (**verify**).
- **Composition** businesses cannot bill a customer in another state (CGST Act s.10(2)(c)); the invoice is blocked with a clear message. **Unregistered** businesses issue a plain "Invoice" with no tax in either case.

### 4.3 Tax rates
- Since **22 Sep 2025 (GST 2.0)**, the main slabs are **5% and 18%**, with **40%** on sin and luxury goods. Many essentials are 0%. Special rates such as 0.25% and 3% exist for specific goods.
- Seed `tax_rates` with: 0, 0.25, 3, 5, 18, 40. Keep **12 and 28 as inactive** rows so older data still renders. Store rates in **basis points** (18% = `1800`).

### 4.4 Money & quantity representation (non-negotiable)
- All money is **integer paise** (`bigint` in DB). **Never floats.**
- Quantity is an **integer in milli-units** (1.5 kg = `1500`) so fractional quantities are exact.
- Rates are basis points. Rounding is **round-half-up to the nearest paisa**, implemented once in `src/server/domain/money.ts`.

### 4.5 Line calculation (implement as pure functions with tests)
For each line:
```
gross            = round(qty_milli * unit_price_paise / 1000)
if price_includes_tax:
    taxable_before_discount = round(gross * 10000 / (10000 + rate_bp))
else:
    taxable_before_discount = gross
taxable          = taxable_before_discount - discount_paise          (discount ≥ 0, ≤ taxable)
if intra-state:
    cgst = sgst(or utgst) = round(taxable * (rate_bp / 2) / 10000)   (always equal halves)
    igst = 0
else:
    igst = round(taxable * rate_bp / 10000); cgst = sgst = 0
line_total       = taxable + cgst + sgst + igst
```
Invoice totals are **sums of the line values** (never recomputed from aggregates). Optional **round-off** to the nearest rupee is shown as a separate "Round off" line; 50 paise rounds up, so it is between −₹0.49 and +₹0.50. Invoices under the **composition** scheme (Bill of Supply) or from an unregistered business carry **no tax lines**: the line rate and the "price includes tax" flag are ignored and `taxable = gross − discount`.

**Discount** is always taken off **before tax**, including on tax-inclusive lines (it comes off the backed-out taxable value). The form labels it "Discount (before tax)".

**Invariants (property-based tests with fast-check):**
- `Σ line_total + round_off = grand_total`
- `cgst == sgst` (or `cgst == utgst`) on every intra-state line
- Tax-inclusive back-calculation: `|taxable + tax − gross| ≤ 1 paisa` per line
- No negative values. `0 ≤ discount ≤ taxable_before_discount`.
- **The server always recomputes totals.** Totals from the client are ignored.

### 4.6 Invoice numbering
- Financial year runs 1 April – 31 March, in **Asia/Kolkata** time.
- The number is assigned **only when issuing** (drafts have none). Numbers are **consecutive and gapless per business, per series, per FY**.
- Format: `{prefix}/{FY}/{seq}`, for example `GAL/26-27/0042`. **Max 16 characters**, allowed characters `A–Z a–z 0–9 - /` (Rule 46). Validate the prefix length so the full number always fits.
- Series: `INV` (tax invoice / bill of supply) and `CN` (credit notes), each with its own counter. Both prefixes are set by the business (defaults `INV` and `CN`), are 1–5 letters, digits or hyphens, and must differ (ignoring case), e.g. `CN/26-27/0001`. A 5-character prefix fits 9,999 documents per FY; shorter prefixes fit more.
- **Concurrency-safe:** use a `number_sequences` row locked with `SELECT … FOR UPDATE` (or `UPDATE … RETURNING`) inside the same transaction that issues the invoice. An integration test fires 50 parallel issues and asserts the resulting numbers are unique and gapless.
- Cancelled invoices **keep** their number. Numbers are never reused.

### 4.7 Mandatory invoice contents (Rule 46, verify)
Supplier name, address and GSTIN; invoice number and date; recipient name and address, and GSTIN if registered; for unregistered recipients with value ≥ ₹50,000, recipient name, address and state; place of supply (state name and code) for inter-state; HSN/SAC, description, quantity and unit (UQC), taxable value, rate and amount of each tax; total; "Whether tax is payable on reverse charge: No"; signature (image or "Authorised Signatory"). Also print the amount in words using the Indian system (lakh, crore), in English in v1: "Rupees One Lakh Twenty Thousand and Fifty Paise Only".

**HSN digits:** a business with AATO ≤ ₹5 cr needs a 4-digit HSN on B2B invoices; above that, 6 digits (verify). Enforce this with a business-level setting.

**Composition scheme:** the title is "Bill of Supply" with the line "Composition taxable person, not eligible to collect tax on supplies".

### 4.8 Invoice lifecycle
```
DRAFT ──issue──▶ ISSUED ──payment──▶ PARTIALLY_PAID ──payment──▶ PAID
   │                │
 delete          cancel (owner, reason required) ──▶ CANCELLED
                    └─ credit note (full/partial) reduces balance
```
- **Issued invoices are immutable.** Corrections are made by cancelling or issuing a credit note. Every change is written to the audit log.
- `OVERDUE` is **derived** (due_date < today in IST, and balance > 0), not stored.
- `balance = grand_total − Σ payments allocated − Σ credit notes`.

### 4.9 Udhaar / customer ledger
- Ledger = opening balance + issued invoices − payments − credit notes, in date order with a running balance.
- Payments can be allocated to specific invoices or left on account (auto-allocated oldest first).
- Receivables aging buckets: 0–30, 31–60, 61–90, 90+ days past due.

### 4.10 GST export for the CA (GSTR-1 helper)
An Excel workbook (built with exceljs) for a chosen month or quarter, with sheets:
- **B2B:** invoices to registered customers, grouped by GSTIN
- **B2CL:** inter-state invoices to unregistered buyers above the threshold (currently **₹1 lakh** since Aug 2024, verify; keep this in config)
- **B2CS:** everything else to unregistered buyers, summarised by place of supply and rate
- **CDNR / CDNUR:** credit notes
- **HSN summary** and **Documents summary** (number ranges issued and cancelled)

Label the export clearly as **"Helper for your CA — not a filed return."** Match column headers to the GST offline tool template as closely as possible.

---

## 5. Features & acceptance criteria

Each feature is done only when its acceptance criteria pass as automated tests.

### F1. Auth & onboarding
- Email and password, email OTP or magic link, and Google sign-in.
- After first login, a 3-step onboarding: business details → GSTIN (optional; select "Unregistered/Composition" as needed) → invoice prefix and UPI ID. A live invoice preview updates while the user types.
- Invite members by email with a role. The invite expires in 7 days.
- **AC:** a new user can sign up and issue their first invoice in < 3 minutes in an e2e test. A user with no membership in business B gets 404 for every B route and API.

### F2. Products
- Fields: name, HSN/SAC, unit (UQC: NOS, PCS, KGS, GMS, LTR, MTR, BOX, SET, DOZ, PAC …), price, tax rate, price-includes-tax, SKU (optional), active.
- Fuzzy search with Postgres `pg_trgm`. CSV import with a preview, per-row errors and a downloadable template.
- Soft delete (archive) if the product was used on any invoice.
- **AC:** importing 500 rows takes < 10 s. Bad rows are reported with line numbers and nothing partial is committed.

### F3. Customers
- Fields: name, phone (E.164, +91 default), email, GSTIN (validated), billing address and state, shipping address, opening balance, credit days (for the due date).
- Duplicate detection on phone and GSTIN. CSV import.
- **AC:** an invalid GSTIN checksum is rejected with a clear message. The state auto-fills from the GSTIN.

### F4. Invoice builder (the most important screen; mobile-first)
- Pick or create a customer inline; add lines by searching products (or typing a one-off item); edit qty, price and discount; totals update live.
- Place of supply and tax type are shown automatically ("Intra-state: CGST + SGST") with an override.
- Keyboard-friendly on desktop and thumb-friendly on mobile. Autosave drafts.
- "Issue" assigns the number and locks the invoice. A confirmation sheet offers: Share on WhatsApp, Copy link, Download PDF, Print, Record payment.
- **AC:** the e2e test creates and issues an invoice with 3 lines (one tax-inclusive, one with a discount, one fractional qty). The totals match the expected fixture to the paisa.

### F5. PDF & public link
- Generate PDFs with `@react-pdf/renderer` (no headless Chrome, so it is serverless-friendly). A4 and 80 mm thermal layouts. Embed Noto Sans and Noto Sans Devanagari fonts so ₹ and Hindi render.
- Public link `/i/{token}`: a 128-bit random token, `noindex`, rate-limited, with view, download and a **UPI QR / "Pay via UPI" button**.
- UPI link format: `upi://pay?pa={vpa}&pn={name}&am={amount}&cu=INR&tn={invoiceNo}`.
- The owner can revoke and regenerate the token.
- **AC:** a snapshot test of the PDF text content. A revoked token returns 404.

### F6. WhatsApp share
- `https://wa.me/{phone}?text={encoded message}` with a template: greeting, invoice number, amount, due date, link. Templates are editable in settings, in English and Hindi.
- **AC:** the link is correctly URL-encoded (unit test) and the phone is normalised to digits with the country code.

### F7. Payments & ledger
- Record a payment: date, amount, mode, reference (UTR or cheque number), notes, and allocation.
- Overpayment is not allowed against an invoice; any excess goes to "on account".
- Customer page: ledger with running balance, aging, a "Send reminder" (WhatsApp) button, and a downloadable statement PDF.
- **AC:** ledger balance = Σ invoices − Σ payments − Σ credit notes for randomly generated data (property test).

### F8. Dashboard & reports
- Cards: today's sales, this month's sales, GST collected this month, total receivable, overdue.
- Charts: daily sales over 30 days, top 5 products, top 5 debtors, aging buckets.
- Reports: sales register (CSV/Excel), GSTR-1 helper (§4.10), HSN summary. All use a date range picker in IST.
- **AC:** dashboard queries return in < 300 ms p95 with 10k invoices seeded.

### F9. Notifications & jobs
- Email an invoice to the customer (via Resend) with the PDF link.
- **Daily job** (once a day fits Vercel Hobby cron): (a) email reminders for invoices due today or overdue on day 1, 7 and 14, for customers who have an email; (b) an owner digest: "₹X overdue from N customers", with WhatsApp reminder links.
- Every job is **idempotent** (it records what was already sent) and protected by a `CRON_SECRET` header.
- **AC:** running the job twice sends each reminder once.

### F10. Settings
- Business profile, logo and signature upload (Vercel Blob, max 1 MB, images only, re-encoded), bank details, UPI ID, invoice prefix and terms, WhatsApp templates, language, members and roles, data export (all data as a ZIP of CSVs), delete business.

### F11. Audit log
- Append-only table: actor, business, entity type and id, action, before and after JSON diff, IP hash, timestamp.
- Written in the **same transaction** as the change. Viewable by owner and accountant with filters.

### F12. Demo mode (for recruiters)
- "Try the live demo" on the landing page logs in to a shared **demo business** as the Owner or Staff role, with no signup.
- The seed creates 1 demo business with about 60 products, 120 customers and 6 months of realistic invoices (mix of B2B/B2C, intra/inter-state, paid, partial and overdue), plus credit notes and payments. Use `@faker-js/faker` with the `en_IN` locale plus curated HSN and product lists.
- A banner says "Demo data — resets daily". Emails are suppressed in demo. Demo writes are rate-limited.
- A **daily cron reset** restores it to the seed snapshot.

---

## 6. Non-functional requirements

### 6.1 Performance
- Mobile-first, usable at 360 px width. Lighthouse mobile ≥ 90 for Performance and Accessibility on key pages.
- LCP < 2.5 s on simulated 4G. Server actions < 500 ms p95 (warm). The invoice list is paginated with cursors (no OFFSET on large tables).
- Indexes on every foreign key and on `(business_id, created_at)`, `(business_id, status)`, `(business_id, invoice_date)`, plus trigram indexes for search.

### 6.2 Security (aim for OWASP ASVS Level 1)
- **Tenant isolation:** every tenant table has `business_id NOT NULL`. All data access goes through repository functions that **require** a `TenantContext { userId, businessId, role }` and always filter by `business_id`. No raw cross-tenant queries outside `src/server/db/admin/`. An isolation test suite runs every service function as a user of a different business and expects `NotFound`.
- Validate every input with Zod at the boundary (server actions, route handlers, CSV rows).
- IDs are UUIDv7 (sortable, not guessable). Public tokens are separate random 128-bit values.
- Secure, HttpOnly, SameSite=Lax cookies. Strict CSP with nonces, HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy.
- Rate limits with `@upstash/ratelimit`: auth 5/min/IP; public invoice 60/min/IP; mutations 120/min/user; demo stricter.
- Secrets live only in env vars, validated at boot with `@t3-oss/env-nextjs`. `.env.example` is committed; real `.env` never is.
- Never log PII (phone, email, GSTIN, addresses). Logs use IDs only.
- Dependabot, `pnpm audit` in CI, and GitHub CodeQL. Run `gitleaks` in CI for secret scanning.
- File uploads: check MIME type and size, and re-encode images.

### 6.3 Privacy & legal
- India's **DPDP Act, 2023:** the shop (business) controls its customers' data, and Galla processes it on the business's behalf. Publish a Privacy Policy and Terms; provide data export and deletion of a business; collect only needed data. (Have this reviewed before real launch.)
- GST record retention: businesses must keep records for years (72 months under current law, verify). On delete, warn the owner and offer a full export first.
- Show the "Not tax/legal advice" disclaimer in the footer and on exports.

### 6.4 Reliability & operations
- `/api/health` checks DB connectivity and returns version and commit SHA. An uptime monitor (UptimeRobot or Better Stack free) checks it every 5 minutes.
- Errors and performance are tracked in **Sentry** with source maps and release tags. Product analytics are in **PostHog** (no PII, and respect Do Not Track).
- Structured JSON logs (`pino`) with `requestId` and `businessId`.
- **Backups:** Neon point-in-time restore (limited window on the free plan), **plus** a nightly `pg_dump` from GitHub Actions, encrypted with `age` and uploaded to object storage (Cloudflare R2 or Backblaze B2). The restore steps are documented and tested monthly into a Neon branch.
- `docs/runbook.md`: how to roll back a deploy, restore the DB, rotate secrets, and handle "invoice numbers out of sequence".

### 6.5 Accessibility & i18n
- WCAG 2.1 AA: labels on all inputs, focus states, color contrast, full keyboard navigation, `aria-live` on totals.
- `next-intl` with `en` and `hi`. Money via `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`. Dates are DD-MM-YYYY in IST.

---

## 7. Architecture

### 7.1 Stack
| Concern | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript (strict)**, one full-stack app | One deploy; serverless on Vercel; no uptime-hours problem |
| UI | Tailwind CSS + shadcn/ui + react-hook-form + Zod | Fast, accessible components |
| DB | **PostgreSQL on Neon** (serverless, free plan; branch per PR) | Real SQL, scale to zero |
| ORM | **Drizzle ORM** + drizzle-kit migrations (SQL committed) | Thin, explicit SQL, row locks, serverless-friendly |
| DB driver | `@neondatabase/serverless` **Pool (WebSocket)** for transactions; HTTP driver for simple reads | Interactive transactions are needed for numbering |
| Auth | **Better Auth** (organization plugin for multi-tenancy, roles, invites) | Self-hosted, data in our DB |
| Cache / rate limit / scheduling | Upstash Redis + `@upstash/ratelimit`; Upstash QStash if we ever need more than daily jobs | Serverless, free tier |
| Jobs | Vercel Cron (daily on Hobby) → route handlers | No worker server |
| PDF | `@react-pdf/renderer` | No Chromium needed |
| Excel | `exceljs` | GSTR-1 helper |
| Email | Resend + React Email | Needs a verified domain to email real customers |
| Files | Vercel Blob | Logos and signatures |
| Observability | Sentry, PostHog, pino | Free tiers |
| Tests | Vitest, fast-check, Testing Library, Playwright | Unit, property, integration, e2e |
| CI/CD | GitHub Actions → Vercel (preview per PR, prod on `main`) | Standard |
| Package manager | pnpm; Node LTS pinned in `.nvmrc` and `engines` | Reproducible |

> Vercel's Hobby plan is intended for personal, non-commercial use. If Galla ever charges money, move to Pro. Check Vercel's current terms.

### 7.2 Layering (strict)
```
UI (app/ routes, components)  →  Server Actions / Route Handlers (thin: auth, zod-parse, call service, map errors)
                                    →  Services (src/server/services: business workflows, authz checks, transactions, audit)
                                        →  Domain (src/server/domain: PURE functions — GST math, GSTIN, FY, numbering format, amount-in-words)
                                        →  Repositories (src/server/db/repos: tenant-scoped queries only)
```
- The **domain layer has zero imports** from Next.js, the DB or the network. It has 100% unit-test coverage.
- Services return typed results. Domain errors (`NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`) are mapped to HTTP or UI messages in one place.

### 7.3 Folder structure
```
.
├── CLAUDE.md  SPEC.md  BUILD_PLAN.md  README.md  .env.example  .nvmrc
├── docs/  architecture.md  runbook.md  adr/0001-….md
├── scripts/  seed.ts  seed-demo.ts  backup.sh  restore.md
├── drizzle/  (generated SQL migrations — committed, never edited after merge)
├── src/
│   ├── app/
│   │   ├── (marketing)/  page.tsx  privacy/  terms/
│   │   ├── (auth)/  login/  signup/  invite/[token]/
│   │   ├── (app)/b/[businessSlug]/  dashboard/ invoices/ customers/ products/ payments/ reports/ settings/ audit/
│   │   ├── i/[token]/  (public invoice page)
│   │   └── api/  health/  auth/[...all]/  cron/daily/  cron/demo-reset/  pdf/[id]/
│   ├── components/  ui/ (shadcn)  invoice/  forms/  charts/
│   ├── server/
│   │   ├── domain/  money.ts  gst/  gstin.ts  states.ts  fy.ts  numbering.ts  amount-in-words.ts
│   │   ├── services/  invoice.service.ts  payment.service.ts  customer.service.ts …
│   │   ├── db/  schema/  client.ts  repos/  admin/
│   │   ├── authz/  permissions.ts  context.ts
│   │   ├── pdf/  exports/  notifications/  jobs/
│   ├── lib/  env.ts  logger.ts  ratelimit.ts  errors.ts  i18n/
│   └── messages/  en.json  hi.json
└── tests/  unit/  integration/  e2e/  fixtures/
```

### 7.4 Data model (Postgres)
All tenant tables have: `id uuid pk (v7)`, `business_id uuid not null fk`, `created_at`, `updated_at`, `created_by`. Money is `bigint` paise.

| Table | Key columns |
|---|---|
| `businesses` | slug (unique), legal_name, trade_name, gstin (nullable), gst_scheme (`REGULAR`/`COMPOSITION`/`UNREGISTERED`), state_code, address fields, phone, email, logo_url, signature_url, upi_vpa, bank_* , invoice_prefix, credit_note_prefix, terms, hsn_digits_required, round_off_enabled, locale, is_demo |
| `members` / auth tables | managed by Better Auth (user, session, account, organization, member with role, invitation) |
| `states` (reference) | code, name, is_ut_without_legislature |
| `tax_rates` (reference) | rate_bp, label, active |
| `units` (reference) | uqc_code, label |
| `products` | name, hsn_sac, unit, price_paise, rate_bp, price_includes_tax, sku, archived_at |
| `customers` | name, phone_e164, email, gstin, billing_* , billing_state_code, shipping_* , opening_balance_paise, credit_days, archived_at |
| `number_sequences` | business_id, series (`INV`/`CN`), fy (`26-27`), next_value — **unique(business_id, series, fy)** |
| `invoices` | type (`TAX_INVOICE`/`BILL_OF_SUPPLY`/`INVOICE`), status, number (nullable until issued; **unique(business_id, number)**), fy, invoice_date (date), due_date, customer_id, **customer snapshot JSON** (name, GSTIN, addresses as at issue), place_of_supply_state_code, is_inter_state, reverse_charge (false), subtotal_taxable, cgst, sgst, utgst, igst, round_off, grand_total, amount_paid, notes, public_token (unique), token_revoked_at, issued_at, cancelled_at, cancel_reason, version |
| `invoice_lines` | invoice_id, position, product_id (nullable), **snapshot**: description, hsn_sac, unit, qty_milli, unit_price_paise, price_includes_tax, discount_paise, rate_bp, taxable, cgst, sgst, utgst, igst, line_total |
| `credit_notes` (+ lines) | same shape, linked `invoice_id`, reason, own CN number series |
| `payments` | customer_id, date, amount_paise, mode, reference, notes |
| `payment_allocations` | payment_id, invoice_id, amount_paise |
| `reminders_sent` | invoice_id, kind (`DUE`, `D1`, `D7`, `D14`), channel, sent_at — **unique(invoice_id, kind, channel)** for idempotency |
| `audit_logs` | actor_user_id, business_id, entity, entity_id, action, diff jsonb, ip_hash, at |

**Snapshots:** issued invoices copy customer and product details, so later edits to a customer or product never change a past invoice.

**DB constraints are the last line of defence:** CHECK constraints (amounts ≥ 0; intra-state lines have `igst = 0` and `cgst = sgst + utgst`, with only one of sgst/utgst non-zero; inter-state lines have `cgst = sgst = utgst = 0`; `status` enum), FKs with `ON DELETE RESTRICT` on financial data, and unique constraints as listed.

### 7.5 Environments & deployment
| Env | App | DB | Notes |
|---|---|---|---|
| Local | `pnpm dev` | Docker Postgres 16 (`docker compose up`) | `pnpm db:migrate && pnpm db:seed` |
| Preview (each PR) | Vercel preview | Neon **branch** per PR | Playwright e2e runs against it |
| Production | Vercel prod on `main` | Neon main branch | Migrations applied in CI **before** promote |

Migrations use the **expand → migrate → contract** pattern for breaking changes. Never edit a migration that has been merged.

### 7.6 CI pipeline (GitHub Actions)
On every PR: install (cached pnpm) → `lint` → `format:check` → `typecheck` → `test:unit` (coverage gate: domain 100%, services ≥ 85%) → `test:integration` (Postgres service container) → `build` → gitleaks → CodeQL. Then on the Vercel preview: `test:e2e` (Playwright, with traces uploaded on failure).
Branch protection on `main`: all checks green, squash merge, Conventional Commits. Release notes come from commits (`CHANGELOG.md`).

---

## 8. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Domain unit | Vitest + **fast-check** | GST math invariants (§4.5), GSTIN checksum, FY boundaries (31 Mar 23:59 IST vs 1 Apr 00:00), numbering format ≤ 16 chars, amount in words (0, 1, 99, 1,00,000, 12,34,56,789.50) |
| Service integration | Vitest + real Postgres | Numbering under 50 concurrent issues; **tenant isolation** for every service; immutability of issued invoices; ledger math; idempotent jobs |
| Component | Testing Library | Invoice builder totals update, form validation messages |
| E2E | Playwright (mobile + desktop viewports) | Signup → onboarding → product → customer → invoice → PDF → public link → payment → ledger → GSTR-1 export downloads |
| Accessibility | `@axe-core/playwright` | No serious violations on key pages |
| Load (manual, documented) | k6 | 50 virtual users creating invoices; record p95 in README |

Shared, hand-verified **golden fixtures** (`tests/fixtures/invoices/*.json`) hold expected totals to the paisa. Ideally a CA or accountant friend checks 5 of them once.

---

## 9. Seed & demo data
- `scripts/seed.ts`: reference data (states, tax rates, UQC units) plus one local dev business.
- `scripts/seed-demo.ts`: the demo business (§F12). It is **deterministic** (fixed faker seed), so the demo looks the same after every reset and tests can rely on it.
- Products come from curated lists with realistic HSN codes and rates (hardware, stationery, FMCG), not random strings.

---

## 10. Documentation deliverables (part of "done")
- **README.md:** problem, demo link, a 2-minute video, screenshots, architecture diagram (Mermaid), tech decisions, how to run locally, test commands, metrics (load test p95, Lighthouse), roadmap, and a case study once real users exist.
- **docs/adr/:** one ADR per key decision (Next.js monolith, Drizzle, integer money, tenant scoping, gapless numbering, PDF library, no gateway in v1).
- **docs/runbook.md**, **docs/architecture.md**, **CHANGELOG.md**, **PRIVACY** and **TERMS** pages.

---

## 11. Roadmap after v1
1. Razorpay payment links in test mode, with webhook to auto-mark invoices paid (signature-verified, idempotent)
2. Automated WhatsApp via the WhatsApp Business Platform
3. Simple inventory (stock in and out)
4. **Data track:** analytics warehouse (dbt) over Galla data, with a Metabase dashboard
5. **AI track:** upload a supplier bill photo or PDF → extract fields with an LLM → human review screen → save
6. PWA install and offline drafts

---

## 12. Glossary
**AATO**: aggregate annual turnover · **B2B/B2C**: sale to a registered or unregistered buyer · **CGST/SGST/UTGST/IGST**: central / state / union-territory / integrated GST · **Composition scheme**: simplified scheme where small businesses pay a flat tax and can't charge GST · **FY**: financial year (Apr–Mar) · **GSTIN**: 15-character GST ID · **GSTR-1**: monthly or quarterly return of outward supplies · **HSN/SAC**: product and service classification codes · **Place of supply**: the state that decides intra- vs inter-state tax · **Udhaar**: goods sold on credit · **UQC**: unit quantity code · **UPI VPA**: UPI ID such as `shop@okaxis`
