import { POST as forwardToSentry } from "@sentry/nextjs/tunnel";

import { env } from "@/lib/env";

/**
 * The browser's Sentry events arrive here and are forwarded to Sentry without the request's
 * headers (no cookies, no IP), only for our own DSN (ADR 0016). Same origin, so the CSP's
 * `connect-src 'self'` covers it and ad blockers don't drop error reports. Without a DSN there
 * is nothing to forward to: a plain 404, not the tunnel's 500.
 */
export function POST(request: Request): Promise<Response> {
  if (!env.NEXT_PUBLIC_SENTRY_DSN) return Promise.resolve(new Response(null, { status: 404 }));
  return forwardToSentry(request);
}
