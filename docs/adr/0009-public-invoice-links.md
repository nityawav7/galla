# ADR 0009: Public invoice links

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

A shop sends each customer a link to their invoice (SPEC F5): the customer opens it on a phone without an account, sees the invoice, downloads the PDF and pays by UPI. Everything else in Galla starts from a signed-in user's `TenantContext` and filters by `business_id` (ADR 0003); cross-tenant queries are allowed only in `src/server/db/admin/` for jobs. A link has no user and no business in it, so finding the invoice is a lookup by token alone.

## Decision

- **The token is the secret.** Every invoice gets 16 random bytes (128 bits, 22 base64url characters) when it is issued. It is unique, never derived from ids, and anything that doesn't have its exact shape is never looked up.
- **One read-only lookup outside tenant scope**, in `src/server/db/public/invoice-by-token.ts`. It returns only an issued or cancelled invoice whose link is on, with its own lines (joined on the invoice's own `business_id`) and the business's payment details. ESLint lets only `src/server/services/public-invoice.service.ts` import it, so no other code path can look invoices up by token. This is the one exception to ADR 0003, and it is not in `db/admin/` because that folder is reserved for jobs.
- **Dead links all look the same.** Unknown, malformed, revoked and draft tokens give the same 404, for the page and the PDF.
- **Turn off and new link (owner only).** "Turn off" sets `token_revoked_at`. "New link" writes a fresh token and clears it, so any old link is dead for good. Both run under the invoice row lock and write an audit row in the same transaction; the diff records whether the link is on, never the token. The immutability trigger (ADR 0006) already allows exactly these two columns to change after issue. Owners and staff can copy the link (`invoice:share`); only owners can manage it (`invoice:manageLink`). Accountants can't see it.
- **The proxy guards `/i/*`** before anything renders: 60 requests a minute per IP (SPEC §6.2, Upstash in production; dead links count too, so guessing is limited), then a 404 rewrite for a dead link. A streamed page can no longer change its status code, so the check can't wait for the page.
- **Private headers:** `X-Robots-Tag: noindex, nofollow`, `<meta name="robots" content="noindex, nofollow">`, `Referrer-Policy: no-referrer` (the token never leaves in a Referer header) and `Cache-Control: private, no-store`.
- **Payment:** the page shows the balance due, a "Pay via UPI" button (phones) with the SPEC F5 `upi://pay` link, and the same link as an inline SVG QR code. Like the PDF, it reads the UPI ID live and shows nothing to pay on a cancelled or settled invoice.

## Consequences

- Anyone the customer forwards the link to can see the invoice, including the customer's name, address and GSTIN. That is what an emailed or WhatsApp'd PDF does too; the owner can turn the link off at any time.
- The link preview in WhatsApp shows only the generic title "Invoice": the page title is not built from the invoice, so no amounts or names leak into previews.
- The token stays in the database in plain text. It grants read access to one invoice only, so hashing it was judged not worth losing the ability to show the owner the link again.
- Credit notes have no public link in v1 (decision 11): they are append-only and have no token column.
