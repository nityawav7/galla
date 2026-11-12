import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubEvent, scrubSpan } from "@/lib/observability/scrub";
import {
  SENTRY_TRACES_SAMPLE_RATE,
  SENTRY_TUNNEL_PATH,
  sentryOptions,
} from "@/lib/observability/sentry-options";

describe("sentryOptions", () => {
  it("is off without a DSN", () => {
    expect(sentryOptions(undefined, undefined)).toMatchObject({
      enabled: false,
      environment: "development",
    });
  });

  it("collects nothing personal and scrubs every event, breadcrumb and span", () => {
    const options = sentryOptions("https://key@o1.ingest.sentry.io/2", "production");
    expect(options.enabled).toBe(true);
    expect(options.environment).toBe("production");
    expect(options.tracesSampleRate).toBe(SENTRY_TRACES_SAMPLE_RATE);
    expect(SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
    expect(options.dataCollection).toEqual({
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
    });
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(options.beforeSendSpan).toBe(scrubSpan);
    expect(options.beforeSendLog()).toBeNull();
    expect(options.beforeSendMetric()).toBeNull();
  });

  it("sends browser events to our own origin", () => {
    expect(SENTRY_TUNNEL_PATH).toBe("/api/monitoring");
  });
});
