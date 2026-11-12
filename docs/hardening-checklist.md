# Hardening checklist

Phase 11 (SPEC §6, BUILD_PLAN Phase 11): what was verified before launch, with the evidence, and what is still open. Each PR of Phase 11 adds its part; 11f completes it.

## Accessibility (11c, 2026-11-12)

**Automated check:** `@axe-core/playwright` runs inside the e2e tests (`expectAccessible` in `tests/e2e/support.ts`) with the WCAG 2.0, 2.1 and 2.2 A/AA rules, at **360 px and at 1280 px** on every page below. A **serious or critical** violation fails the test (decision 7); moderate and minor ones would be attached to the Playwright report. There are none today.

| Page                                    | Where it is checked                 | Result        |
| --------------------------------------- | ----------------------------------- | ------------- |
| Home, sign-in, sign-up, forgot password | `smoke.spec.ts`, both browser sizes | no violations |
| Settings                                | mobile journey, after onboarding    | no violations |
| Invoice builder (3 lines, before issue) | mobile journey                      | no violations |
| Invoice page                            | mobile journey                      | no violations |
| Public invoice (`/i/{token}`)           | mobile journey, signed out          | no violations |
| Payments list, record payment           | mobile journey                      | no violations |
| Customer page (ledger)                  | mobile journey                      | no violations |
| Dashboard (with data)                   | mobile journey                      | no violations |
| Reports                                 | mobile journey                      | no violations |
| Activity                                | mobile journey                      | no violations |

The e2e-after-deploy workflow runs the public-page check against production too.

**Fixed in 11c** (found by the first run):

- **Contrast (WCAG 1.4.3):** grey helper text on the light grey panels (WhatsApp message previews, the invoice page's totals box) was 4.3:1; the muted text colour is now `oklch(0.5 0 0)` (about 5.6:1 there, 6.4:1 on white). Red text on the light red fills (the "Delete draft" and void buttons, the "Overdue" badge) is now `oklch(0.505 0.213 27.518)` (Tailwind red-700) instead of red-600.
- **Name matches what you see (WCAG 2.5.3):** the WhatsApp placeholder buttons show `{dueDate}` but were named "Due date"; a voice-control user saying "click dueDate" couldn't reach them. Their name is now `{dueDate}: Due date`.
- **Keyboard scrolling (WCAG 2.1.1):** the invoice's line table (on the invoice page and the public invoice) and the HSN summary scroll sideways on a phone and had nothing focusable inside; they are now focusable regions with a label and a focus outline.

**By hand:** labels on every input, focus states and `aria-live` on totals were built in from Phase 2 (CLAUDE.md); keyboard-only use of the invoice builder is covered by its e2e steps (typing, Enter in search). Not yet checked with a real screen reader (TalkBack or NVDA): **open**.

## Lighthouse (11c, 2026-11-12)

Lighthouse 13.6.0, mobile preset (412 px screen, simulated slow 4G: 150 ms RTT, 1.6 Mbps; 4× CPU slowdown), headless Chrome 157 on a Windows laptop. Three runs per page, median shown. Signed-in pages and the public invoice ran against a **local production build** (`next build` + `next start`, local Postgres) with a test account, because Lighthouse can't sign in to production with a real account; the sign-in page ran against production too.

| Page                  | Server                 | Performance    | Accessibility | Best practices | LCP   | TBT    |
| --------------------- | ---------------------- | -------------- | ------------- | -------------- | ----- | ------ |
| Sign-in               | **production**         | **83** (82–84) | 100           | 96             | 1.0 s | 713 ms |
| Sign-in               | local production build | 99             | 100           | 96             | 0.9 s | 148 ms |
| Dashboard (with data) | local production build | 94 (93–98)     | 100           | 100            | 3.1 s | 56 ms  |
| Invoice page          | local production build | 90 (88–99)     | 100           | 100            | 3.5 s | 106 ms |
| Public invoice        | local production build | 99             | 100           | 100            | 0.9 s | 134 ms |

SPEC §6.1 asks for ≥ 90 Performance and Accessibility on key pages. **Accessibility is 100 everywhere. Performance on the production sign-in page is 83: open.**

- Why: Total Blocking Time. The page runs about 650 KB of JavaScript (React and Next.js about 360 KB, Zod about 150 KB, react-hook-form, Radix tabs, the Better Auth client, next-intl), and every page also carries all of the English or Hindi messages (about 50 KB) in its payload. With Lighthouse's real (DevTools) throttling the same page scores about 60 on **both** production and the local build, so production isn't slower: the simulated score is kinder to a server on the same machine.
- Not caused by 11a: LCP is 1.0 s (the server answers in about 50 ms); the cost is the scripts, which were the same when the page was prerendered.
- Candidate fixes, to measure one by one: send each page only the message namespaces its client components use; validate the sign-in and sign-up forms without full Zod on the client (the server keeps its Zod schemas); load the "Email code" tab's code only when it is opened.
- "Best practices 96" on sign-in is Lighthouse reporting a Content-Security-Policy issue with no details. The e2e tests see no CSP violation in the console on any page they visit, so this is left as is for now (ADR 0015).

## Security (11a)

See [`security-review.md`](security-review.md) and [ADR 0015](adr/0015-csp-with-nonces.md): headers and CSP on every response (checked in production after the 11a deploy: every header present, all 18 scripts on `/login` carry the nonce, no console errors), the mutation limit and request ids.

## Audit log (11b)

The Activity page (SPEC F11): owners and accountants, filters, keyset paging; no new index needed (EXPLAIN on 40,000 rows: 0.15 ms for a page 30,000 rows deep).

## Observability (11d)

Sentry and PostHog, off until their keys are set ([ADR 0016](adr/0016-observability-without-pii.md)). Verified on a local production build with placeholder keys, so nothing left the machine:

- **What Sentry would send:** an error thrown from `/login?next=/b/sharma-hardware` was sent to `/api/monitoring` (Sentry's `beforeEnvelope` hook shows the envelope). Its message `…/b/sharma-hardware/customers?q=Ravi` arrived as `…/b/:slug/customers`; its URL had no query string, and it carried no user, no headers, `infer_ip: never` and the commit as its release.
- **What PostHog would send:** "Email invoice" sent one event to `/api/relay/e/` with only `event`, `$lib`, `$lib_version`, a random `distinct_id`, the project key and `$process_person_profile: false`.
- **Cost:** sign-in page JavaScript went from 762 KB to 775 KB; Sentry loads when the page is idle and PostHog on its first event.
- **No CSP violations:** both go to our own origin.

## Still to come in Phase 11

- 11d: error tracking (Sentry) and product analytics (PostHog), without PII.
- 11e: nightly encrypted backups and a tested restore.
- 11f: architecture, runbook (rollback, restore, secret rotation), k6 load test.
