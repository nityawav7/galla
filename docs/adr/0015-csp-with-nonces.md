# ADR 0015: A strict CSP with nonces, and every page rendered per request

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

SPEC §6.2 asks for a strict Content-Security-Policy with nonces, HSTS, `X-Frame-Options: DENY`, a Referrer-Policy and a Permissions-Policy. A nonce must be new for every response, so it can only go into HTML rendered for that request. Galla had `cacheComponents` (with Partial Prerendering) and `partialPrefetching` on: `/login`, `/signup` and `/forgot-password` were prerendered at build time, and every other page served a prerendered shell before streaming its data. Those prerendered scripts carry no nonce.

We tried it: with the nonce policy on, the production build of `/login` had every script blocked (each bundle and every inline script), so the page didn't work. Next.js's own guide says the same: "Partial Prerendering is incompatible with nonce-based CSP". The alternatives were a policy with `'unsafe-inline'` scripts (which doesn't stop injected inline scripts, the main thing a CSP is for), or Next's experimental hash-based Subresource Integrity, which doesn't cover the inline scripts Next writes into each page.

## Decision

- **Every page is rendered per request.** `cacheComponents` and `partialPrefetching` are off, and the root layout awaits `connection()`. Galla's pages already showed per-user data and used no `"use cache"`, so only the static frame (header and skeletons) of each page stops being prebuilt; data still streams through the same Suspense boundaries.
- **The proxy** (`src/proxy.ts`, now on every page, not only `/b`, `/i` and `/onboarding`) makes a 128-bit nonce per request and sends `Content-Security-Policy` both to the page (Next.js reads the nonce from it and puts it on its own scripts) and to the browser:
  `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`.
  Inline styles stay allowed: React `style` attributes and the server-drawn charts use them, and CSS can't run code. `next dev` also gets `'unsafe-eval'`.
- **Static headers** from `next.config.ts` on every response: HSTS (2 years, subdomains, preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (the public invoice keeps `no-referrer`), and a Permissions-Policy that turns off camera, microphone, geolocation, payment, USB and the rest.
- The e2e journey fails on any CSP violation the browser reports, on every page it visits.

## Consequences

- First paint waits for the server to start rendering instead of coming from a prebuilt shell. Phase 11c measures it with Lighthouse (target ≥ 90 on mobile); if a page falls short, the fix is less work before its first Suspense boundary, not a weaker policy.
- Adding a third-party script or service (Sentry, PostHog in Phase 11d) means adding its origin to `connect-src` (or loading it from our own origin); anything else is blocked by design.
- Vercel's preview toolbar (comments, from `vercel.live`) is injected into preview deployments without our nonce, so the CSP blocks it; with `'strict-dynamic'` no host allowlist can let it through. Previews show a console error for it and work otherwise; the e2e CSP check ignores it. Turn the toolbar off in Vercel (Settings → General → Vercel Toolbar) if the noise matters.
- Turning `cacheComponents` back on needs a CSP that works with prebuilt HTML; revisit if Next.js adds nonce support for prerendered shells.
