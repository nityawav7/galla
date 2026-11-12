/**
 * Sentry and PostHog in the browser, loaded lazily so they never slow down a page (ADR 0016).
 * Both SDKs together are about 540 KB of JavaScript; loaded up front they more than doubled the
 * sign-in page's script. So:
 *
 * - Sentry loads once the page is idle. Errors thrown before that are held (up to 10) and sent
 *   when it arrives, so an early crash is still reported.
 * - PostHog loads the first time one of its four events happens; most visits never load it.
 *
 * Without NEXT_PUBLIC_SENTRY_DSN / NEXT_PUBLIC_POSTHOG_KEY nothing is ever loaded.
 */
import type * as Sentry from "@sentry/nextjs";
import type PostHog from "posthog-js";

import { ANALYTICS_RELAY_PATH, sanitizeAnalyticsEvent } from "./analytics";
import { SENTRY_TUNNEL_PATH, sentryOptions } from "./sentry-options";

type SentryModule = typeof Sentry;
type PostHogClient = typeof PostHog;

const EARLY_ERROR_LIMIT = 10;
/** Load Sentry when the browser is idle, or after this long at the latest. */
const SENTRY_IDLE_TIMEOUT_MS = 4000;

const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let sentry: Promise<SentryModule> | undefined;
let posthog: Promise<PostHogClient> | undefined;
const earlyErrors: unknown[] = [];

function holdError(event: ErrorEvent): void {
  if (earlyErrors.length < EARLY_ERROR_LIMIT) earlyErrors.push(event.error ?? event.message);
}

function holdRejection(event: PromiseRejectionEvent): void {
  if (earlyErrors.length < EARLY_ERROR_LIMIT) earlyErrors.push(event.reason);
}

function loadSentry(): Promise<SentryModule> {
  sentry ??= import("@sentry/nextjs").then((sdk) => {
    sdk.init({
      ...sentryOptions(sentryDsn, process.env.NEXT_PUBLIC_VERCEL_ENV),
      tunnel: SENTRY_TUNNEL_PATH,
    });
    window.removeEventListener("error", holdError);
    window.removeEventListener("unhandledrejection", holdRejection);
    for (const error of earlyErrors.splice(0)) sdk.captureException(error);
    return sdk;
  });
  return sentry;
}

/** Called once by <StartObservability /> in the root layout, after the first render. */
export function startObservability(): void {
  if (!sentryDsn || typeof window === "undefined") return;
  window.addEventListener("error", holdError);
  window.addEventListener("unhandledrejection", holdRejection);
  const load = () => void loadSentry();
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(load, { timeout: SENTRY_IDLE_TIMEOUT_MS });
  } else {
    setTimeout(load, SENTRY_IDLE_TIMEOUT_MS);
  }
}

/** Reports an error caught by an error boundary (loads Sentry now if it isn't yet). */
export function reportError(error: unknown): void {
  if (!sentryDsn || typeof window === "undefined") return;
  void loadSentry().then((sdk) => sdk.captureException(error));
}

/**
 * PostHog, set up on first use: only the named events, nothing stored in the browser (no
 * cookies, no localStorage), no person profiles, Do Not Track respected.
 */
export function loadAnalytics(): Promise<PostHogClient> | undefined {
  if (!posthogKey || typeof window === "undefined") return undefined;
  posthog ??= import("posthog-js").then(({ default: client }) => {
    client.init(posthogKey, {
      api_host: ANALYTICS_RELAY_PATH,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      rageclick: false,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      advanced_disable_toolbar_metrics: true,
      persistence: "memory",
      person_profiles: "never",
      respect_dnt: true,
      save_referrer: false,
      save_campaign_params: false,
      before_send: sanitizeAnalyticsEvent,
    });
    return client;
  });
  return posthog;
}
