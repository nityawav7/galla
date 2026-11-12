import type { CaptureResult } from "posthog-js";

/**
 * Product analytics without anything personal (SPEC §6.4, ADR 0016, decision 10). Only these
 * named events are ever sent, each with only the properties listed here: no page views, no
 * clicks, no URLs, no user ids, no names, no amounts.
 */
export const ANALYTICS_EVENTS = {
  /** An invoice was issued; how long it took from opening the builder (SPEC's "time to issue"). */
  invoice_issued: ["seconds_to_issue", "line_count"],
  payment_recorded: ["mode"],
  reminder_shared: ["channel"],
  invoice_emailed: [],
} as const satisfies Record<string, readonly string[]>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProperties<E extends AnalyticsEvent> = Partial<
  Record<(typeof ANALYTICS_EVENTS)[E][number], string | number>
>;

/** Same-origin path the browser sends events to; our route forwards them to PostHog. */
export const ANALYTICS_RELAY_PATH = "/api/relay";

/** What PostHog itself needs to accept an event; everything else it adds is dropped. */
const SDK_PROPERTIES = new Set([
  "token",
  "distinct_id",
  "$lib",
  "$lib_version",
  "$process_person_profile",
]);

function isAnalyticsEvent(name: string): name is AnalyticsEvent {
  return Object.hasOwn(ANALYTICS_EVENTS, name);
}

/**
 * posthog-js `before_send`: drops any event not in the list (including PostHog's own, like
 * `$pageview` or `$exception`) and every property PostHog adds (URL, referrer, screen, browser,
 * device, session) except the few it needs to accept the event.
 */
export function sanitizeAnalyticsEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event || !isAnalyticsEvent(event.event)) return null;
  const allowed: readonly string[] = ANALYTICS_EVENTS[event.event];
  const properties = Object.fromEntries(
    Object.entries(event.properties).filter(
      ([key]) => SDK_PROPERTIES.has(key) || allowed.includes(key),
    ),
  );
  const sanitized: CaptureResult = { ...event, properties };
  // `$set` and friends would build a person profile; there are none (person_profiles: "never").
  delete sanitized.$set;
  delete sanitized.$set_once;
  delete sanitized.$unset;
  return sanitized;
}
