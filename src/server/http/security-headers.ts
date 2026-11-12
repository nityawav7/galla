/*
 * Browser security headers (SPEC §6.2, PR 11a of the Phase 11 plan). The static ones go on every
 * response from next.config.ts; the Content-Security-Policy carries a fresh nonce per request and
 * is set by the proxy, which Next.js reads to put the same nonce on its own scripts.
 */

/** Sent with every response (next.config.ts `headers()`). */
export const STATIC_SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "usb=()",
      "browsing-topics=()",
    ].join(", "),
  },
];

export interface CspOptions {
  /** `next dev` needs eval for fast refresh and React's dev tools. */
  dev: boolean;
  /** Extra origins the browser may call (error and analytics services, Phase 11d). */
  connectSrc?: readonly string[];
}

/**
 * A strict policy: scripts only with this request's nonce (and what they load, `strict-dynamic`),
 * no plugins, no framing, no other origins. Inline `style` attributes stay allowed: React and the
 * server-drawn charts use them, and styles can't run code.
 */
export function contentSecurityPolicy(nonce: string, options: CspOptions): string {
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(options.dev ? ["'unsafe-eval'"] : []),
    ],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...(options.connectSrc ?? [])],
    ["frame-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["object-src", "'none'"],
    ...(options.dev ? [] : ([["upgrade-insecure-requests"]] as [string][])),
  ];
  return directives.map((parts) => parts.join(" ")).join("; ");
}

/** 128 random bits, base64: a new one for every request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The id that ties a request's log lines together: Vercel's own request id when there is one (so
 * it matches Vercel's request log), else a new one.
 */
export function requestIdFrom(headers: Headers): string {
  const vercel = headers.get("x-vercel-id");
  if (vercel && /^[\w:-]{1,128}$/.test(vercel)) return vercel;
  return crypto.randomUUID();
}
