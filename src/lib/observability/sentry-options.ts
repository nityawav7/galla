import { scrubBreadcrumb, scrubEvent, scrubSpan } from "./scrub";

/** Where the browser sends Sentry envelopes: our own origin, so the CSP stays `connect-src 'self'`. */
export const SENTRY_TUNNEL_PATH = "/api/monitoring";

/** 10% of requests traced (decision 9); every error is still reported. */
export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

/**
 * Sentry options shared by the browser, server and edge (ADR 0016). Everything is off when
 * there is no DSN. Nothing personal is sent: no user, cookies, headers, bodies, query strings,
 * local variables, logs or metrics, and URLs lose their invoice tokens and business slugs.
 */
export function sentryOptions(dsn: string | undefined, environment: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: environment ?? "development",
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendSpan: scrubSpan,
    // Logs and metrics are on by default in Sentry 11; pino's logs go to Vercel instead.
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
  };
}
