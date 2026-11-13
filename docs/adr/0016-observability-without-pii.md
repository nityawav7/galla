# ADR 0016: Error tracking and product analytics without personal data

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

SPEC §6.4 asks for errors and performance in **Sentry** (with source maps and release tags) and product analytics in **PostHog** with no PII, respecting Do Not Track. CLAUDE.md rule 9 says we never log names, phones, emails, GSTINs or addresses. Two constraints shape how:

- The strict CSP (ADR 0015) allows `connect-src 'self'` only.
- The sign-in page already misses the Lighthouse performance target (83 against 90, `docs/hardening-checklist.md`). The two SDKs together are about 540 KB of JavaScript; loaded up front they took the sign-in page from 762 KB to 1.54 MB of script.

## Decision

**Both are off unless their keys are set** (`NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`); without them nothing is loaded or sent.

**Same-origin routes instead of new CSP origins.** The browser talks only to our own server:

- `POST /api/monitoring`: Sentry's own tunnel handler (`@sentry/nextjs/tunnel`). It forwards envelopes for our DSN only, without the request's headers (no cookies, no IP).
- `POST /api/relay/{e,i/v0/e,batch,capture}`: our relay (`src/server/http/analytics-relay.ts`). It forwards only the body and `content-type`/`content-encoding` to PostHog, so PostHog never sees the visitor's cookies or IP. Anything else (feature flags, remote config, recordings) is a 404. Bodies over 256 KB are refused, and each visitor gets 120 events a minute.

A plain Next.js rewrite was rejected because it forwards cookies, including the session cookie. Allowing `*.sentry.io` and `*.posthog.com` in the CSP was rejected because it weakens the policy, and ad blockers drop those requests anyway.

**Loaded lazily:**

- Sentry loads only when there is an error to report. `<StartObservability />` in the root layout listens for uncaught errors and rejections; the first one loads Sentry, and up to 10 errors are held until it arrives. Error boundaries load it too. (Until 2026-11-13 it loaded on every page once the browser was idle. Its 445 KB took about 0.5 s of a phone's main thread, and the production landing page scored 80 on Lighthouse against 93 without it.)
- PostHog loads on its first event; most visits never load it. Net cost on the sign-in page: 13 KB.
- `instrumentation-client.ts` isn't used: with Turbopack it shipped a second copy of Next's router (about 130 KB) to every page. The cost is no Sentry span for client-side navigations. Since Sentry now loads only on an error, browser page loads aren't traced either; server requests still are (10%), and every browser error is still reported.

**Nothing personal leaves.** For Sentry:

- `dataCollection` turns off the user, cookies, headers, bodies, query strings, database query data and stack-frame variables, and the IP is never inferred.
- `beforeSend`, `beforeBreadcrumb` and `beforeSendSpan` (`src/lib/observability/scrub.ts`) replace `/i/{token}` (a secret link), `/b/{slug}` (made from the shop's name) and `/invite/{id}` in every URL, message, tag and breadcrumb, and drop query strings.
- Sentry's logs and metrics are dropped; pino's logs stay in Vercel.
- 10% of requests are traced. There is no Session Replay and no feedback widget.

For PostHog:

- **Four named events:** `invoice_issued` (seconds from opening the builder, line count), `payment_recorded` (mode), `reminder_shared` (channel) and `invoice_emailed`.
- **`before_send`** drops every other event, including PostHog's own `$pageview` and `$exception`. It strips every property PostHog adds (URL, referrer, screen, browser, session) except the library name and version, the project key and a random per-page id.
- **No identity or stored state:** no `identify`, `person_profiles: "never"`, `persistence: "memory"` (no cookies, no localStorage), and autocapture, page views, recordings, surveys, heatmaps, flags and external scripts are all off. `respect_dnt: true` honours Do Not Track.

**Source maps** are uploaded at build time only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are all set (on Vercel), then deleted from the public output. The release is the commit SHA. The build plugin's telemetry is off.

**Next's trailing-slash redirect is off** (`skipTrailingSlashRedirect`). posthog-js posts to `/e/`, and the redirect to `/e` broke the event over plain HTTP and costs a round trip anyway. `src/proxy.ts` now redirects pages with a trailing slash itself (308), so page URLs behave as before.

## Consequences

- An outage at Sentry or PostHog shows up as 500 or 502 answers from our two routes, and nothing else breaks. Analytics events are best-effort.
- Errors in the first moments of a page that Sentry's global handlers wouldn't see (for example, React recovering from a hydration mismatch) can be missed until Sentry loads.
- Product numbers are anonymous counts, so there is no per-user funnel. "Time to issue" comes from `seconds_to_issue`.
- PostHog's project setting **Discard client IP data** should be on as well. Our relay already hides the visitor's IP, and PostHog only sees Vercel's.
- A new event or property must be added to `ANALYTICS_EVENTS`; anything else is dropped before sending.
