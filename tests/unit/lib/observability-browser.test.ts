import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));
const posthog = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);
vi.mock("posthog-js", () => ({ default: posthog }));

/** A browser window with its event listeners under the test's control. */
function fakeWindow() {
  const listeners = new Map<string, (event: unknown) => void>();
  const window = {
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
  };
  vi.stubGlobal("window", window);
  return {
    window,
    fire: (type: string, event: unknown) => listeners.get(type)?.(event),
    listening: () => [...listeners.keys()],
  };
}

async function load(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const browser = await import("@/lib/observability/browser");
  const track = await import("@/lib/observability/track");
  return { ...browser, ...track };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const DSN = "https://key@o1.ingest.sentry.io/2";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Sentry in the browser", () => {
  it("is not loaded on a page without errors, even after a while", async () => {
    vi.useFakeTimers();
    const page = fakeWindow();
    const { startObservability } = await load({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    startObservability();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(page.listening()).toEqual(["error", "unhandledrejection"]);
  });

  it("loads on the first error, through our tunnel, and sends every error held until then", async () => {
    const page = fakeWindow();
    const { startObservability } = await load({
      NEXT_PUBLIC_SENTRY_DSN: DSN,
      NEXT_PUBLIC_VERCEL_ENV: "production",
    });
    startObservability();
    const early = new Error("hydration");
    page.fire("error", { error: early, message: "hydration" });
    page.fire("error", { message: "Script error." });
    page.fire("unhandledrejection", { reason: "rejected" });

    await flush();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: DSN, environment: "production", tunnel: "/api/monitoring" }),
    );
    expect(sentry.captureException.mock.calls).toEqual([[early], ["Script error."], ["rejected"]]);
    expect(page.listening()).toEqual([]);
  });

  it("holds at most 10 errors while Sentry loads", async () => {
    const page = fakeWindow();
    const { startObservability } = await load({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    startObservability();
    for (let index = 0; index < 15; index += 1) {
      page.fire("error", { error: new Error(String(index)) });
      page.fire("unhandledrejection", { reason: index });
    }
    await flush();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(10);
  });

  it("reports error-boundary errors, loading Sentry once", async () => {
    fakeWindow();
    const { startObservability, reportError } = await load({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    startObservability();
    const boom = new Error("boundary");
    reportError(boom);
    reportError(boom);
    await flush();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.captureException.mock.calls).toEqual([[boom], [boom]]);
  });

  it("does nothing without a DSN or on the server", async () => {
    const page = fakeWindow();
    const off = await load({ NEXT_PUBLIC_SENTRY_DSN: undefined });
    off.startObservability();
    off.reportError(new Error("x"));
    expect(page.window.addEventListener).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    const server = await load({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    server.startObservability();
    server.reportError(new Error("x"));
    await flush();
    expect(sentry.init).not.toHaveBeenCalled();
  });
});

describe("PostHog in the browser", () => {
  it("loads on the first event, private by default, then counts each event", async () => {
    fakeWindow();
    const { track } = await load({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" });
    expect(posthog.init).not.toHaveBeenCalled();
    track("payment_recorded", { mode: "UPI" });
    track("invoice_emailed");
    await flush();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "/api/relay",
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        disable_external_dependency_loading: true,
        advanced_disable_flags: true,
        persistence: "memory",
        person_profiles: "never",
        respect_dnt: true,
      }),
    );
    expect(posthog.capture.mock.calls).toEqual([
      ["payment_recorded", { mode: "UPI" }],
      ["invoice_emailed", {}],
    ]);
  });

  it("does nothing without a key or on the server", async () => {
    fakeWindow();
    const off = await load({ NEXT_PUBLIC_POSTHOG_KEY: undefined });
    off.track("invoice_emailed");
    vi.unstubAllGlobals();
    const server = await load({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" });
    server.track("invoice_emailed");
    await flush();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("times a flow in whole seconds", async () => {
    const { secondsSince, startTimer } = await load({});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    const start = startTimer();
    vi.setSystemTime(new Date("2026-11-12T10:00:41.6Z"));
    expect(secondsSince(start)).toBe(42);
    expect(secondsSince(null)).toBe(0);
  });
});
