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
| Copy an invoice's public link, share it | ✅ | ❌ | ✅ |
| Turn a public link off, make a new one | ✅ | ❌ | ❌ |
| Record payments | ✅ | ✅ | ✅ |
| Void a payment | ✅ | ❌ | ❌ |
| Refund money on account, void a refund | ✅ | ❌ | ❌ |
| View all invoices, ledger, dashboard | ✅ | ✅ | ✅ (dashboard totals hidden) |
| Download GST exports & reports | ✅ | ✅ | ❌ |
| View audit log | ✅ | ✅ | ❌ |

Permissions are defined **once** in `src/server/authz/permissions.ts` and checked in **every service function**, not only in the UI. Staff's hidden dashboard totals are their own action (`dashboard:viewTotals`), and Better Auth's invite and member roles are generated from the same file.

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
- v1 accepts only the regular taxpayer format (14th character `Z`) with an active state code. Other formats (TDS/TCS, UN bodies, non-resident) get a clear "not supported yet" message. Any 15-character value that starts with 2 digits and has another 14th character gets this message.

### 4.2 States & place of supply
- Seed the official **GST state code list** (01 Jammu & Kashmir … 37 Andhra Pradesh, 38 Ladakh, 97 Other Territory). Verify it against the GST portal and store it in a `states` reference table with a `is_ut_without_legislature` flag.
- **Place of supply (v1 rule for goods):** the customer's state (shipping state if one is given, otherwise billing state). If the customer is unregistered and has no state, use the business's state. The user can override it per invoice.
- **Intra-state** (business state = place of supply): **CGST + SGST**, or **CGST + UTGST** for UTs without a legislature.
- **Inter-state:** **IGST**.
- UTGST applies in 04 Chandigarh, 26 Dadra and Nagar Haveli and Daman and Diu, 31 Lakshadweep, 35 Andaman and Nicobar Islands and 38 Ladakh. 01 Jammu and Kashmir, 07 Delhi and 34 Puducherry have legislatures and charge SGST. Legacy codes 25 (Daman and Diu) and 28 (undivided Andhra Pradesh) are kept **inactive** so old data renders. 97 Other Territory is treated as UTGST (**verify**).
- **Composition** businesses cannot bill a customer in another state (CGST Act s.10(2)(c)); the invoice is blocked with a clear message. **Unregistered** businesses issue a plain "Invoice" with no tax in either case. Billing another state is **allowed with a warning** (`UNREGISTERED_INTER_STATE`) shown before issuing: inter-state sales usually require registration (CGST Act s.24(i)), but a shop selling only exempt goods may legitimately be unregistered.

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
- **Concurrency-safe:** the `number_sequences` row is incremented with one upsert (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), which also locks it, as the last step of the transaction that issues the invoice ([ADR 0006](docs/adr/0006-gapless-numbering-and-immutable-invoices.md)). A rollback gives the number back. An integration test fires 50 parallel issues and asserts the resulting numbers are unique and gapless.
- The invoice date is the day it is issued, in IST; there is no backdating in v1, so numbers stay in date order.
- Cancelled invoices **keep** their number. Numbers are never reused.

### 4.7 Mandatory invoice contents (Rule 46, verify)
Supplier name, address and GSTIN; invoice number and date; recipient name and address, and GSTIN if registered; for unregistered recipients with value ≥ ₹50,000, recipient name, address and state; place of supply (state name and code) for inter-state; HSN/SAC, description, quantity and unit (UQC), taxable value, rate and amount of each tax; total; "Whether tax is payable on reverse charge: No"; signature (image or "Authorised Signatory"). Also print the amount in words using the Indian system (lakh, crore), in English in v1: "Rupees One Lakh Twenty Thousand and Fifty Paise Only".

**HSN digits:** a business with AATO ≤ ₹5 cr needs a 4-digit HSN on B2B invoices; above that, 6 digits (verify). Enforce this with a business-level setting. Issuing checks it: with 4, every line to a registered customer needs an HSN; with 6, every line needs at least 6 digits. A Bill of Supply follows the same rule, a plain Invoice from an unregistered business never needs one (CA question 5 in `docs/golden-fixtures.md`).

**Unregistered recipients at ₹50,000 or more:** issuing needs a customer with name, billing address and state, so such a sale can't be a walk-in. The invoice total is compared, and the amount lives in config (CA question 4).

**Composition scheme:** the title is "Bill of Supply" with the line "Composition taxable person, not eligible to collect tax on supplies".

### 4.8 Invoice lifecycle
```
DRAFT ──issue──▶ ISSUED ──payment──▶ PARTIALLY_PAID ──payment──▶ PAID
   │                │
 delete          cancel (owner, reason required) ──▶ CANCELLED
                    └─ credit note (full/partial) reduces balance
```
- **Issued invoices are immutable.** Corrections are made by cancelling or issuing a credit note. Every change is written to the audit log. Database triggers refuse any other change to an issued invoice or its lines, and any change to a credit note.
- A draft is a working copy (`invoices.draft`, JSON) that may hold half-typed lines. Its lines become `invoice_lines` snapshots when it is issued. Creating and deleting a draft are audited; autosaves are not, because the issue row records the final invoice.
- `OVERDUE` is **derived** (due_date < today in IST, and balance > 0), not stored.
- `balance = grand_total − Σ payments allocated − Σ credit notes`. The invoice keeps `amount_paid_paise` and `amount_credited_paise`, and a CHECK keeps their sum within the grand total.
- `CREDITED` (balance cleared by credit notes only) is also derived for display.
- The stored status follows the money (a CHECK enforces it): nothing paid → `ISSUED`; paid with something still due → `PARTIALLY_PAID`; paid with nothing due → `PAID`. A payment, a credit note (one that clears a part-paid invoice makes it `PAID`) and a voided payment (back to `PARTIALLY_PAID` or `ISSUED`) all move it.
- **Cancel** (owner only): only an issued invoice with nothing paid or credited. It keeps its number and lines; the reason is required. The dialog warns to use a credit note if the invoice is already in a filed GSTR-1 (CA question 6).
- **Credit notes** (owner only) return quantities of the invoice's lines at their own amounts ([ADR 0007](docs/adr/0007-credit-notes-by-returned-quantity.md)): never more than is left on a line or not yet credited on the invoice. On a paid invoice, what was paid beyond its new total is released from its payments, newest first, and becomes the customer's money on account; for a walk-in sale the owner says how it was given back and a refund is recorded with the note ([ADR 0011](docs/adr/0011-credit-notes-on-paid-invoices-and-refunds.md)). Only the note that returns the last unit carries the invoice's round-off, so a full return credits exactly the grand total. Each takes the next number of the `CN` series.

### 4.9 Udhaar / customer ledger
- Ledger = opening balance + issued invoices − payments − credit notes + refunds, in date order with a running balance. Cancelled invoices and voided payments are left out. With a start date, earlier rows fold into a "balance brought forward".
- Payments are allocated to specific invoices or "oldest first": the opening balance owed, then invoices by invoice date and number. Nothing is allocated beyond an item's balance; the rest stays **on account** ([ADR 0010](docs/adr/0010-payments-allocation-and-ledger.md)).
- The opening balance is an allocation end: payments can pay the opening balance owed, and an opening advance can pay invoices. Once used, the opening balance can't be lowered below what was applied.
- Money on account (an opening advance or overpayments) is applied by "Apply advance" (oldest first, or chosen), never by itself.
- Receivables aging buckets: 0–30, 31–60, 61–90, 90+ days past due, plus "not due yet". 0 days = due today; an invoice without a due date is due on its invoice date; overdue means due before today. The opening balance still owed and money on account sit beside the buckets so the total equals the ledger balance.

### 4.10 GST export for the CA (GSTR-1 helper)
An Excel workbook (built with `write-excel-file`, [ADR 0012](docs/adr/0012-reports-files-and-charts.md)) for a chosen month or quarter, with sheets:
- **B2B:** invoices to registered customers, grouped by GSTIN
- **B2CL:** inter-state invoices to unregistered buyers above the threshold (currently **₹1 lakh** since Aug 2024, verify; keep this in config)
- **B2CS:** everything else to unregistered buyers, summarised by place of supply and rate
- **CDNR / CDNUR:** credit notes
- **HSN summary** and **Documents summary** (number ranges issued and cancelled)

Label the export clearly as **"Helper for your CA — not a filed return."** Match column headers to the GST offline tool template as closely as possible.

Built in Phase 9c ([ADR 0013](docs/adr/0013-gstr1-helper.md)): on the Reports page, for the last 12 months or 4 quarters (QRMP), regular GST businesses only. B2CL is an inter-state invoice to an unregistered buyer above `B2CL_THRESHOLD_PAISE` incl. tax; credit notes go to CDNR (GSTIN), CDNUR (against B2CL) or reduce B2CS; 0% lines are nil-rated in EXEMP; HSN is split into B2B and B2C tables by HSN, UQC and rate; DOCS gives each series' range and cancelled count; cancelled invoices appear only in DOCS. A "Read me" sheet comes first with the label, the business, GSTIN, period and a check-before-filing list. Open CA questions 10–14 in `docs/golden-fixtures.md`.

---

## 5. Features & acceptance criteria

Each feature is done only when its acceptance criteria pass as automated tests.

### F1. Auth & onboarding
- Email and password, a 6-digit email code (also used to verify the email and reset the password), and Google sign-in. No magic links: they often open in a different browser than the one the user started in ([ADR 0004](docs/adr/0004-auth-and-tenancy.md)).
- Email verification is required to accept an invite, not to start billing.
- After first login, a 3-step onboarding: business details → GSTIN (optional; select "Unregistered/Composition" as needed) → invoice prefix and UPI ID. A live invoice preview updates while the user types.
- Invite members by email with a role. The invite expires in 7 days. The owner also sees the link to share it on WhatsApp. Accepting needs a signed-in account with the invited, verified email. A business always keeps at least one owner.
- **AC:** a new user can sign up and issue their first invoice in < 3 minutes in an e2e test. A user with no membership in business B gets 404 for every B route and API.

### F2. Products
- Fields: name, HSN/SAC, unit (UQC: NOS, PCS, KGS, GMS, LTR, MTR, BOX, SET, DOZ, PAC …), price, tax rate, price-includes-tax, SKU (optional), active.
- HSN/SAC is optional on the product and has 4, 6 or 8 digits. The digits an invoice needs are checked when it is issued (Phase 6). SKUs are unique among a business's active products.
- The list is A–Z with cursor pagination (50 a page). Fuzzy search with Postgres `pg_trgm` on the name, plus an SKU prefix, returns the best 50 matches.
- CSV import with a preview, per-row errors (line and column) and a downloadable template ([ADR 0005](docs/adr/0005-csv-import.md)). The server checks the file again on import, which creates new products only. At most 1,000 rows and 900 KB per file.
- Products are always archived, never deleted, and can be restored unless an active product has taken the SKU. Archived products are hidden from lists and new invoices; past invoices keep their own copy.
- **AC:** importing 500 rows takes < 10 s. Bad rows are reported with line numbers and nothing partial is committed.

### F3. Customers
- Fields: name, phone (E.164, +91 default), email, GSTIN (validated), billing address and state, shipping address, opening balance, credit days (for the due date). Only the name is required, so a walk-in customer needs nothing else.
- A valid GSTIN fills the billing state. A different state is refused unless the user ticks "keep this state" (SPEC §4.1), and that override is recorded in the audit log. A CSV file can't override it.
- The opening balance is entered as "customer owes you" or "advance paid to you" plus an amount, and stored signed (negative means an advance). In a CSV, a negative amount means an advance. Credit days run from 0 to 365.
- Duplicate detection:
  - A GSTIN identifies one active customer per business, so a second one is refused.
  - A phone number may be shared (families, shops), so the form names the other customers who have it and asks "Save anyway". In an import it is a warning that doesn't block.
- The list works like products: A–Z, cursor pages, archive and restore. Search finds a name with typos, phone digits (4 or more) and a GSTIN prefix.
- CSV import is the same as for products ([ADR 0005](docs/adr/0005-csv-import.md)). States may be written as a code (`27`, `7`) or a name (`Maharashtra`).
- **AC:** an invalid GSTIN checksum is rejected with a clear message. The state auto-fills from the GSTIN.

### F4. Invoice builder (the most important screen; mobile-first)
- Pick or create a customer inline; add lines by searching products (or typing a one-off item); edit qty, price and discount; totals update live.
- Place of supply and tax type are shown automatically ("Intra-state: CGST + SGST") with an override.
- Keyboard-friendly on desktop and thumb-friendly on mobile. Autosave drafts.
  - The builder runs the same evaluation as the server (`src/lib/invoice-evaluation.ts`, on the domain engine) for live totals and field errors; the server recomputes on every save and issue.
  - A draft row is created on the first change, then saved 1.5 s after each change with a version check. Another tab's save is reported, never overwritten.
  - A walk-in sale needs no customer (an optional name), up to the Rule 46 amount. Product lines show their HSN, unit and rate from the product; one-off lines are typed in full. In the item search, Enter adds the best match.
  - The confirmation sheet offers "View invoice", "New invoice", "Download PDF", "Print" (Phase 7a), the customer's link to copy (Phase 7b) and "Share on WhatsApp" (Phase 7c) and "Record payment" (Phase 8b).
- "Issue" assigns the number and locks the invoice. A warning that is allowed but needs a second look (an unregistered business billing another state) must be ticked first. A confirmation sheet offers: Share on WhatsApp, Copy link, Download PDF, Print, Record payment.
- **AC:** the e2e test creates and issues an invoice with 3 lines (one tax-inclusive, one with a discount, one fractional qty). The totals match the expected fixture to the paisa.

### F5. PDF & public link
- Generate PDFs with `@react-pdf/renderer` (no headless Chrome, so it is serverless-friendly). A4 and 80 mm thermal layouts. Embed Noto Sans and Noto Sans Devanagari fonts so ₹ and Hindi render ([ADR 0008](docs/adr/0008-pdf-with-react-pdf.md)).
  - Signed-in PDFs: `/b/{slug}/invoices/{id}/pdf` and `/b/{slug}/credit-notes/{id}/pdf`, `?format=a4|80mm`, `&download=1` to save (otherwise shown, to print). Every role can open them; other businesses and drafts get 404. Rendered on demand, never stored.
  - Both layouts print the same Rule 46 fields (§4.7) from one printable model: each tax's rate and amount per line (A4) or by rate (80 mm), tax by rate, round-off, amount in words, notes, the business's terms, and "Authorised Signatory". A cancelled invoice is stamped "CANCELLED".
  - Tax content comes from the snapshots. Payment details (UPI ID and bank account) are read live from settings. The UPI QR asks for the balance due and is printed only while something is due on an invoice that isn't cancelled. Credit notes carry no payment block.
  - Labels are English in v1, until the business language setting exists; Hindi names and items print with the Devanagari font. Logos and signature images come with checked uploads (F10).
- Public link `/i/{token}`: a 128-bit random token, `noindex`, rate-limited, with view, download and a **UPI QR / "Pay via UPI" button** ([ADR 0009](docs/adr/0009-public-invoice-links.md)).
  - No sign-in. The proxy limits `/i/*` to 60 requests a minute per IP and answers 404 for an unknown, malformed, turned-off or draft token before the page renders. Responses carry `noindex`, `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store`.
  - The page shows the shop, the balance due, a "Pay via UPI" button on phones and the same link as a QR code (both only while something is due and the invoice isn't cancelled), "Download PDF" (A4 and 80 mm, `/i/{token}/pdf`) and the invoice itself.
  - Owners and staff copy the link from the issued sheet or the invoice page; accountants don't see it.
- UPI link format: `upi://pay?pa={vpa}&pn={name}&am={amount}&cu=INR&tn={invoiceNo}`. The amount is the balance due; the payee name and note are percent-encoded and cut to 50 characters.
- The owner can revoke ("Turn off link") and regenerate ("New link") the token. A new link ends the old one for good. Both are audited without the token.
- **AC:** a snapshot test of the PDF text content. A revoked token returns 404.

### F6. WhatsApp share
- `https://wa.me/{phone}?text={encoded message}` with a template: greeting, invoice number, amount, due date, link. Templates are editable in settings, in English and Hindi.
  - Placeholders: `{customer}`, `{shop}`, `{number}`, `{amount}`, `{dueDate}`, `{link}`. A saved template must contain `{link}`, use only these placeholders and stay under 1,000 characters. Anything else in braces is left as typed; values are inserted as plain text.
  - Values come from the invoice's snapshots: the customer's name (or "Customer"), the shop as printed, the number, the balance due (the total once nothing is due) and the due date (or "on receipt"). The link is the invoice's current public link.
  - The number is the customer's phone as digits with the country code (`+91 98765 43210` → `919876543210`). Without one (a walk-in), the link has no number and WhatsApp asks whom to send it to.
  - The default messages live in `src/messages`; a business that saves the default unchanged stores null, so it keeps getting improvements to the default. Columns `businesses.whatsapp_template_en` and `_hi` (migration `0008`).
  - "Share on WhatsApp" sits on the issued sheet and the invoice page, with an English / Hindi choice (the business language first) and a preview. Owners and staff can share; it needs the public link to be on.
- **AC:** the link is correctly URL-encoded (unit test) and the phone is normalised to digits with the country code.

### F7. Payments & ledger
- Record a payment: date, amount, mode, reference (UTR or cheque number), notes, and allocation.
  - The date is today or up to 365 days back; the amount is at most ₹10 crore. Modes: cash, UPI, bank transfer, cheque, card, other.
  - A walk-in invoice (no customer) is paid only on itself, up to its balance.
  - Every role records payments. Payments are never edited or deleted: the owner **voids** one with a reason (a bounced cheque is a void), and it stays listed, struck through.
  - Payments, voids and "Apply advance" lock the customer, then the payment, then its invoices, and a deferred database trigger checks the allocations against the invoices at commit.
- Overpayment is not allowed against an invoice; any excess goes to "on account".
- Screens (Phase 8b): "Record payment" on the issued sheet and the invoice page opens `payments/new?invoice=…` with that invoice's balance, Cash and today filled in, so a counter sale is paid in two taps. From an invoice, the payment goes to that invoice first and the rest on account; otherwise "Oldest dues first" or "Choose invoices". A live summary shows where the money goes, using the same allocation functions as the server. The Payments page lists payments newest first (customer and date filters), what each paid, and an owner-only "Void" with quick reasons. The invoice page lists its payments, voided ones struck through, and the customer list shows each customer's current balance.
- Customer page (Phase 8c): tapping a customer opens their account; editing moves to `customers/{id}/edit`.
  - The balance ("Owes you" / "Advance"), what is overdue, and an aging bar: not yet due, 0–30, 31–60, 61–90 and over 90 days late, with the opening balance still owed and the advance beside them so the parts add up to the balance. Each part is also listed with its amount, so nothing relies on colour.
  - The account history: opening balance, invoices, credit notes and payments with debit, credit and a running balance, for This FY (default), Since last FY or All time; earlier rows fold into "Balance brought forward". Cancelled invoices and voided payments are left out. Long periods show the latest 100 rows with "Show earlier rows".
  - "Record payment" (back to this page when done), "Apply advance" (money on account to the oldest dues in one tap, when there is both an advance and something due), "Edit", and "Statement PDF".
  - **Statement PDF** (`customers/{id}/statement?period=fy|lastFy|all`): A4, the business as it is now, the customer's address and GSTIN, the period, balance brought forward, every row with Dr/Cr running balance, the closing balance, the aging and a UPI QR for the balance due. Every role can download it; the filename has part of the customer id, never a name.
  - **Send reminder** (owners and staff, when something is due): a WhatsApp click-to-chat message in English or Hindi with the total due, how much is overdue, the opening balance still owed and the 5 oldest open invoices with their balance, due date and public link ("…and N more"). The wording is fixed for now. Each opening writes an audit row `customer.reminderShared` with the amounts and invoice ids (no names or phones), the data for the "recovered within 14 days of a reminder" metric.
- **Refunds** (owner only, Phase 8d): "Refund advance" on the customer page pays back some or all of the money on account (cash, UPI and so on), never more than there is. A refund is never edited or deleted; the owner voids it, and the money counts as on account again. A payment whose money was refunded can't be voided until the refund is. A database trigger checks at commit that refunds never exceed what is on account.
- **AC:** ledger balance = Σ invoices − Σ payments − Σ credit notes + Σ refunds for randomly generated data (property test).

### F8. Dashboard & reports
- Cards: today's sales, this month's sales, GST collected this month, total receivable, overdue.
  - **Sales** are net: invoice totals (incl. GST) dated in the period less credit notes dated in it; cancelled invoices never count. **GST collected** is the tax on those invoices less the tax on those credit notes, and is not shown to composition or unregistered businesses.
  - **To collect** is the sum of positive customer balances plus unpaid walk-in invoices; advances customers hold are shown under it, not netted. **Overdue** is the balance of invoices due before today (the aging rule).
  - **Paid after reminders** (SPEC §1.2): payments within 14 days of a WhatsApp reminder, credited to the latest reminder before them, up to what was overdue when it went out; reminders of the last 30 days.
- Charts: daily sales over 30 days, top 5 products, top 5 debtors, aging buckets. Drawn on the server as SVG and CSS bars (no chart library), each with its numbers as text or a table for screen readers. Top products are by net taxable value over the last 30 days; top debtors by current balance.
- Staff (no `dashboard:viewTotals`) see counts only: invoices today and this month, invoices overdue, and top products by quantity. The service leaves the money out, so it never reaches their browser.
- Reports: sales register (CSV/Excel), GSTR-1 helper (§4.10), HSN summary. All use a date range picker in IST.
  - **Reports page** (owner and accountant, `reports:export`; a "Reports" menu item only for them): presets This month (default), Last month, This quarter, Last quarter (financial quarters) and This FY, or custom dates up to 366 days.
  - **Sales register:** every invoice and credit note in the period by date, with customer, GSTIN, place of supply, taxable value, each tax, round-off, total, paid, credited, balance and status. Cancelled invoices are listed at zero so the number series has no holes; credit notes are negative rows against their invoice. CSV (UTF-8 with BOM, formula-safe) and Excel (sheets "Invoices" and "Credit notes").
  - **HSN summary:** by HSN/SAC, unit and rate: quantity, taxable value, IGST, CGST, SGST/UTGST and total; credit notes subtract; lines without an HSN are grouped and flagged. On screen and as CSV.
- **AC:** dashboard queries return in < 300 ms p95 with 10k invoices seeded.

### F9. Notifications & jobs
- Email an invoice to the customer (via Resend) with the PDF link. "Email invoice" sits next to "Share on WhatsApp" on the issued sheet and the invoice page (owner and staff, `invoice:share`) when the customer has an email, the invoice's link is on and email is set up (on Vercel, `RESEND_API_KEY`; otherwise the button is hidden rather than saying "sent" for an email that would be dropped). The email is in the business's language: the amount due (or the total once paid), the due date, a "View, download or pay by UPI" button to the public link and the shop's name, phone and GSTIN; Reply-To is the shop's email when set. No attachment: the link always shows the invoice as it is now. At most 30 invoice emails an hour per business; each send is audited (`invoice.emailed`, no address).
- **Demo businesses never send email:** `sendEmail` takes the sender (a business or the app itself) and refuses a demo business, so no caller can forget. A demo business can't invite anyone (Phase 12b).
- **Daily job** (once a day fits Vercel Hobby cron; `30 3 * * *` = 09:00 IST, `GET /api/cron/daily`, ADR 0014): (a) email reminders for invoices due today or overdue on day 1, 7 and 14, for customers who have an email; (b) an owner digest: "₹X overdue from N customers", with WhatsApp reminder links.
  - **Email reminders are off by default:** a business switch in Settings ("Email payment reminders to customers"). Live invoices with something due, of customers with an email. A stage whose day had no run still goes out up to 2 days late, never twice and never after a later stage; an invoice due on receipt gets no "due today". **One email per customer** lists every invoice that reached a stage that day, each with its amount, how overdue it is and its link; Reply-To is the shop's email.
  - **Owner digest is on by default** ("Email me what is overdue"): to each owner, once a day, only when something is overdue (live invoices past their due date, or the invoice date when due on receipt): the total, the number of customers, the 10 most overdue customers with a WhatsApp reminder link each (the customer page's "Send reminder" message), and the dashboard.
  - Both are in the business's language, skipped for demo businesses, and skipped entirely when email isn't set up.
  - The job reads businesses 25 at a time through `src/server/db/admin/` (the only cross-tenant code) and starts no new business after 45 s; it logs one line of counts.
- Every job is **idempotent** (it records what was already sent) and protected by a `CRON_SECRET` header. Reminders are claimed in `reminders_sent` (and digests in `owner_digests_sent`) before sending; a failed send gives its claim back so the next run retries. Without `CRON_SECRET` the route answers 503; with a wrong one, 401.
- **AC:** running the job twice sends each reminder once.

### F10. Settings
- Business profile, logo and signature upload (Vercel Blob, max 1 MB, images only, re-encoded), bank details, UPI ID, invoice prefix and terms, WhatsApp templates, language, members and roles, data export (all data as a ZIP of CSVs), delete business.

### F11. Audit log
- Append-only table: actor, business, entity type and id, action, before and after JSON diff, IP hash, timestamp.
- Written in the **same transaction** as the change. Viewable by owner and accountant with filters.
- **Activity page** (`/b/{slug}/audit`, "Activity" in the menu for owners and accountants): newest first, 50 a page (keyset on `at`, `id`, no OFFSET). Filters in a plain GET form: from and to dates (India time), what changed (invoices and credit notes, payments and refunds, customers, products, settings, members) and who (current members). Each row says when (IST), who (the member's name, "Daily job" or "System"), what in words with the invoice or credit note number, customer, product or member name ("Issued invoice SH/26-27/0004", "Recorded a payment from Mehta Traders") linking to it, and the recorded values and edits as before → after, money in ₹, in English or Hindi. Only fields on a fixed list are shown: ids, IP hashes and anything not yet on the list never are.

### F12. Demo mode (for recruiters)
- "Try the live demo" on the landing page logs in to a shared **demo business** as the Owner or Staff role, with no signup.
- The seed creates 1 demo business with about 60 products, 120 customers and 6 months of realistic invoices (mix of B2B/B2C, intra/inter-state, paid, partial and overdue), plus credit notes and payments. Use `@faker-js/faker` with the `en_IN` locale plus curated HSN and product lists.
- A banner says "Demo data — resets daily". Emails are suppressed in demo. Demo writes are rate-limited.
- A **daily cron reset** restores it to the seed snapshot.
- **The landing page (Phase 12c):**
  - **Content:** the problem, three features, real screenshots of the demo at phone size, and the demo buttons, plus sign-up, sign-in and a GitHub link.
  - **Footer:** Privacy and Terms pages, written in plain language and marked as not reviewed by a lawyer, and the "not tax or legal advice" disclaimer.
- **Trying it (Phase 12b):**
  - "Try as the owner" and "Try as staff" on the sign-in page (and the landing page). The server signs the visitor in as "Demo Owner" or "Demo Staff". Their emails are on `galla.invalid`, and their passwords are derived from `BETTER_AUTH_SECRET`; the browser never sees them.
  - Every demo page shows "Demo data — resets daily. Other visitors can see your changes."
  - **Guard rails, enforced on the server:**
    - the demo shop's settings and members can't change;
    - the demo users can't create businesses;
    - Better Auth refuses to change, reset, take over (by email code) or delete the demo accounts, or to sign in to them from a browser.
  - The demo's public links and PDFs say "Sample — demo data, not a real bill", with no UPI or bank details.
  - **Limits:** 10 demo sign-ins an hour and 30 changes a minute per visitor IP.
- **How it is built (Phase 12a, ADR 0018):**
  - **The shop:** *Sharma Hardware & Sanitary*, a fictional hardware store in Pune.
  - **Products:** 60 products, all at 18%.
  - **Customers:** 120, of which 40 are businesses with fictional, checksum-valid GSTINs (10 in other states) and 80 are retail customers on credit. None has a phone or email, and the shop has no UPI ID.
  - **Activity:** about 550 invoices over the last six months (around a third walk-in, paid at the counter), about 500 payments, about 15 credit notes (walk-in returns refunded at the counter) and a few cancellations.
  - **Built by replaying a deterministic plan** through the real services, each event at its own moment, so every total, number and status is what the app itself makes. Dates end yesterday, so the demo never goes stale.
  - **Reset:** `/api/cron/demo-reset` at 04:00 IST; locally `pnpm db:seed:demo`. Emptying it relies on migration 0012, which lets delete guards pass only for a demo business inside a transaction that set the reset flag.

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
- Secure, HttpOnly, SameSite=Lax cookies. Strict CSP with nonces, HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy. The proxy makes a nonce per request for every page (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no framing, no other origins), so every page is rendered per request (ADR 0015). Every server action and route is listed with its permission, input checks and limit in `docs/security-review.md`.
- Rate limits with `@upstash/ratelimit`: auth 5/min/IP; public invoice 60/min/IP (in the proxy, page and PDF together); mutations 120/min/user (every server action that changes data, through `runMutation`; searches and previews are not counted); "Email invoice" 30/hour/business; demo stricter.
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
- Both are off without their keys, reached through our own routes (`/api/monitoring`, `/api/relay`) so the CSP stays `connect-src 'self'` and neither service sees cookies or IPs, and loaded lazily (Sentry on the first error, PostHog on its first event). Sentry gets no user, headers, bodies or query strings, and URLs lose invoice tokens and business slugs. PostHog gets four named events only (`invoice_issued` with seconds to issue, `payment_recorded`, `reminder_shared`, `invoice_emailed`), no identity, nothing stored in the browser. See ADR 0016.
- Structured JSON logs (`pino`) with `requestId` and `businessId`: the proxy passes Vercel's request id (`x-vercel-id`) on as `x-request-id`, and every log line inside a server action or route handler carries it, plus the business once `requireTenant` has resolved it.
- **Backups:** Neon point-in-time restore (6 hours on the free plan), **plus** a nightly `pg_dump` from GitHub Actions at 03:00 IST, encrypted with `age` to a public key in the repo (the private key is kept offline by the owner) and uploaded to a private Backblaze B2 bucket, which deletes files after 30 days (ADR 0017). The restore steps are in `docs/restore.md` and tested monthly: decrypt, restore into a throwaway database, compare with `scripts/backup/check.sql`.
- `docs/runbook.md`: how to roll back a deploy, restore the DB, rotate secrets, and handle "invoice numbers out of sequence".

### 6.5 Accessibility & i18n
- WCAG 2.1 AA: labels on all inputs, focus states, color contrast, full keyboard navigation, `aria-live` on totals.
- Checked automatically: axe (WCAG 2.x A/AA rules) runs in the e2e tests at 360 px and 1280 px on the public pages, settings, the invoice builder and page, the public invoice, payments, a customer, the dashboard, reports and activity; a serious or critical violation fails the build. Lighthouse scores are recorded by hand in `docs/hardening-checklist.md`.
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
| Excel | `write-excel-file` (write-only, [ADR 0012](docs/adr/0012-reports-files-and-charts.md)) | sales register, GSTR-1 helper |
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
├── scripts/  seed.ts  migrate.ts  backup/check.sql
├── drizzle/  (generated SQL migrations — committed, never edited after merge)
├── src/
│   ├── app/
│   │   ├── (marketing)/  page.tsx  privacy/  terms/
│   │   ├── (auth)/  login/  signup/  invite/[token]/
│   │   ├── (app)/b/[businessSlug]/  dashboard/ invoices/ customers/ products/ payments/ reports/ settings/ audit/
│   │   ├── i/[token]/  (public invoice page)
│   │   └── api/  health/  auth/[...all]/  cron/daily/  cron/demo-reset/
│   │       (PDFs: (app)/b/[businessSlug]/invoices/[invoiceId]/pdf and credit-notes/[creditNoteId]/pdf)
│   ├── components/  ui/ (shadcn)  invoice/  forms/  charts/
│   ├── server/
│   │   ├── domain/  money.ts  gst/  gstin.ts  states.ts  fy.ts  numbering.ts  amount-in-words.ts
│   │   ├── services/  invoice.service.ts  payment.service.ts  customer.service.ts …
│   │   ├── db/  schema/  client.ts  repos/  admin/  public/ (token lookup, ADR 0009)
│   │   ├── authz/  permissions.ts  context.ts
│   │   ├── pdf/  exports/  notifications/  jobs/
│   ├── lib/  env.ts  logger.ts  ratelimit.ts  errors.ts  i18n/
│   └── messages/  en.json  hi.json
└── tests/  unit/  integration/  e2e/  fixtures/
```

### 7.4 Data model (Postgres)
All tenant tables have: `id uuid pk (v7)`, `business_id uuid not null fk`, `created_at`, `updated_at`, `created_by`. Money is `bigint` paise in columns ending `_paise`; quantities are `bigint` milli-units (`qty_milli`). The schema lives in `src/server/db/schema/` and [docs/architecture.md](docs/architecture.md#data-model) has the diagram.

| Table | Key columns |
|---|---|
| `businesses` | slug (unique), legal_name, trade_name, gstin (nullable), gst_scheme (`REGULAR`/`COMPOSITION`/`UNREGISTERED`), state_code, address fields, phone, email, logo_url, signature_url, upi_vpa, bank_* , invoice_prefix, credit_note_prefix, terms, hsn_digits_required, round_off_enabled, locale, whatsapp_template_en/_hi (null = default), is_demo |
| `users`, `sessions`, `accounts`, `verifications`, `members`, `invitations` | managed by Better Auth ([ADR 0004](docs/adr/0004-auth-and-tenancy.md)); its organization model is `businesses`. `members.role` is `OWNER`/`ACCOUNTANT`/`STAFF`, one membership per user per business |
| `states` (reference) | code, name, is_ut_without_legislature |
| `tax_rates` (reference) | rate_bp, label, active |
| `units` (reference) | uqc_code, label |
| `products` | name, hsn_sac, unit, price_paise, rate_bp, price_includes_tax, sku, archived_at |
| `customers` | name, phone_e164, email, gstin, billing_* , billing_state_code, shipping_* , opening_balance_paise, credit_days, archived_at |
| `number_sequences` | business_id, series (`INV`/`CN`), fy (`26-27`), next_value — **unique(business_id, series, fy)** |
| `invoices` | type (`TAX_INVOICE`/`BILL_OF_SUPPLY`/`INVOICE`), status, number (nullable until issued; **unique(business_id, number)**), fy, invoice_date (date), due_date, customer_id, **customer snapshot JSON** (name, GSTIN, addresses as at issue), **supplier snapshot JSON** (the business as printed, with its terms since Phase 7), draft (JSON working copy, drafts only), place_of_supply_state_code, is_inter_state, reverse_charge (false), discount, taxable, cgst, sgst, utgst, igst, round_off, grand_total, amount_paid, amount_credited (all `_paise`), notes, public_token (unique), token_revoked_at, issued_at, cancelled_at, cancel_reason, version |
| `invoice_lines` | invoice_id, position, product_id (nullable), **snapshot**: description, hsn_sac, unit, qty_milli, unit_price_paise, price_includes_tax, discount_paise, rate_bp, taxable, cgst, sgst, utgst, igst, line_total |
| `credit_notes` (+ lines) | same shape, linked `invoice_id`, reason, own CN number series. Issued directly (no drafts), so number, fy and snapshot are always set. Each line links the `invoice_line_id` it returns part of |
| `payments` | customer_id (null for a walk-in), payment_date, amount_paise, mode, reference, notes, voided_at, voided_by, void_reason — never updated except to void, never deleted |
| `payment_allocations` | payment_id (null = from the opening advance), invoice_id (null = towards the opening balance), customer_id, amount_paise — **unique nulls not distinct (business_id, payment_id, invoice_id)** |
| `reminders_sent` | invoice_id, kind (`DUE`, `D1`, `D7`, `D14`), channel, sent_at — **unique(invoice_id, kind, channel)** for idempotency |
| `audit_logs` | actor_user_id, business_id, entity, entity_id, action, diff jsonb, ip_hash, at |

**Snapshots:** issued invoices copy customer and product details, so later edits to a customer or product never change a past invoice.

**DB constraints are the last line of defence:** CHECK constraints (amounts ≥ 0; intra-state lines have `igst = 0` and `cgst = sgst + utgst`, with only one of sgst/utgst non-zero; inter-state lines have `cgst = sgst = utgst = 0`; `status` enum; grand and line totals add up; round-off between −49 and +50 paise; numbers only once issued; amount paid ≤ grand total), FKs with `ON DELETE RESTRICT` on financial data, and unique constraints as listed. **Links between tenant tables are composite foreign keys** on `(business_id, x_id)`, so a row can never reference another business's row ([ADR 0003](docs/adr/0003-tenant-isolation.md)). Customer GSTINs and product SKUs are unique per business among non-archived rows.

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
| Load (manual, documented) | k6 | 10 and 50 virtual users creating and issuing invoices through the server actions, on a local production build (`docs/load-test.md`); p95 recorded in README |

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
