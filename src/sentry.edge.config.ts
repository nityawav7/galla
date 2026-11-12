import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options";

// Code on the edge runtime (none today: the proxy runs on Node.js); off without a DSN (ADR 0016).
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.VERCEL_ENV));
