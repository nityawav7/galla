"use client";

import { useEffect } from "react";

import { startObservability } from "@/lib/observability/browser";

/**
 * Starts Sentry (lazily, once the page is idle) in the browser (ADR 0016). A component in the
 * root layout rather than `instrumentation-client.ts`: that file makes Turbopack ship a second
 * copy of Next's router code (about 130 KB) to every page.
 */
export function StartObservability(): null {
  useEffect(() => {
    startObservability();
  }, []);
  return null;
}
