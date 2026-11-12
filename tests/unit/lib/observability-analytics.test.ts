import { type CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENTS, sanitizeAnalyticsEvent } from "@/lib/observability/analytics";

function event(name: string, properties: Record<string, unknown>): CaptureResult {
  return { uuid: "u", event: name, properties };
}

describe("sanitizeAnalyticsEvent", () => {
  it("keeps a named event with only its own properties and what PostHog needs", () => {
    const sanitized = sanitizeAnalyticsEvent({
      ...event("invoice_issued", {
        seconds_to_issue: 42,
        line_count: 3,
        token: "phc_x",
        distinct_id: "anon-1",
        $lib: "web",
        $lib_version: "1.0",
        $process_person_profile: false,
        $current_url: "https://galla.app/b/sharma-hardware/invoices/new",
        $pathname: "/b/sharma-hardware/invoices/new",
        $referrer: "https://google.com/?q=sharma",
        $host: "galla.app",
        $screen_width: 360,
        $browser: "Chrome",
        $session_id: "s1",
        customer: "Ravi Kumar",
      }),
      $set: { email: "a@b.c" },
      $set_once: { name: "x" },
    });
    expect(sanitized).toEqual({
      uuid: "u",
      event: "invoice_issued",
      properties: {
        seconds_to_issue: 42,
        line_count: 3,
        token: "phc_x",
        distinct_id: "anon-1",
        $lib: "web",
        $lib_version: "1.0",
        $process_person_profile: false,
      },
    });
  });

  it("drops PostHog's own events and anything not on the list", () => {
    for (const name of [
      "$pageview",
      "$pageleave",
      "$autocapture",
      "$exception",
      "$identify",
      "secret",
    ]) {
      expect(sanitizeAnalyticsEvent(event(name, { token: "x" }))).toBeNull();
    }
    expect(sanitizeAnalyticsEvent(null)).toBeNull();
  });

  it("lists four events, with no property that could hold a name, amount or URL", () => {
    expect(Object.keys(ANALYTICS_EVENTS)).toEqual([
      "invoice_issued",
      "payment_recorded",
      "reminder_shared",
      "invoice_emailed",
    ]);
    expect(Object.values(ANALYTICS_EVENTS).flat()).toEqual([
      "seconds_to_issue",
      "line_count",
      "mode",
      "channel",
    ]);
  });
});
