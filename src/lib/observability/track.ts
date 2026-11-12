import { type AnalyticsEvent, type AnalyticsProperties } from "./analytics";
import { loadAnalytics } from "./browser";

/**
 * Counts one product event in the browser (ADR 0016). Does nothing when analytics is off (no
 * NEXT_PUBLIC_POSTHOG_KEY) or on the server; PostHog itself skips visitors with Do Not Track.
 */
export function track<E extends AnalyticsEvent>(
  event: E,
  properties: AnalyticsProperties<E> = {},
): void {
  void loadAnalytics()?.then((posthog) => {
    posthog.capture(event, properties);
  });
}

/** Now, for timing a flow in the browser ("time to issue"). */
export function startTimer(): number {
  return Date.now();
}

/** Whole seconds since `start`; 0 when the timer never started. */
export function secondsSince(start: number | null): number {
  return start === null ? 0 : Math.round((Date.now() - start) / 1000);
}
