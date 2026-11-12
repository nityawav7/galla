// The browser's Sentry events arrive here and are forwarded to Sentry without the request's
// headers (no cookies, no IP), only for our own DSN (ADR 0016). Same origin, so the CSP's
// `connect-src 'self'` covers it and ad blockers don't drop error reports.
export { POST } from "@sentry/nextjs/tunnel";
