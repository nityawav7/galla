import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { STATIC_SECURITY_HEADERS } from "./src/server/http/security-headers";

// Fail the build early if required env vars are missing or malformed.
import "./src/lib/env";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // posthog-js posts to "/api/relay/e/"; Next's redirect to "/e" would cost every event a round
  // trip. src/proxy.ts still redirects pages with a trailing slash (ADR 0016).
  skipTrailingSlashRedirect: true,
  // SPEC §6.2. The Content-Security-Policy, with its per-request nonce, comes from src/proxy.ts.
  headers: () => Promise.resolve([{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }]),
  // react-pdf loads fonts and its layout engine at runtime; keep it out of the bundle (ADR 0008).
  serverExternalPackages: ["@react-pdf/renderer"],
  // The PDF fonts are read from disk, so Vercel must copy them into the routes that render PDFs.
  outputFileTracingIncludes: {
    "/**/pdf": ["./src/server/pdf/fonts/*.ttf"],
    "/**/statement": ["./src/server/pdf/fonts/*.ttf"],
    "/i/**": ["./src/server/pdf/fonts/*.ttf"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

// Source maps go to Sentry only when Vercel has all three settings (ADR 0016); they are then
// deleted from the public output, so the browser never gets them.
const uploadSourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: { disable: !uploadSourceMaps, deleteSourcemapsAfterUpload: true },
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
});
