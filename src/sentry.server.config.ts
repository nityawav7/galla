import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options";

// Server (Node.js) errors and traces; off without NEXT_PUBLIC_SENTRY_DSN (ADR 0016).
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.VERCEL_ENV));
