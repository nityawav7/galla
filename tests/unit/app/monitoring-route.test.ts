import { afterEach, describe, expect, it, vi } from "vitest";

const forward = vi.hoisted(() => vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
vi.mock("@sentry/nextjs/tunnel", () => ({ POST: forward }));

async function route(dsn: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  vi.resetModules();
  return import("@/app/api/monitoring/route");
}

const envelope = () =>
  new Request("https://galla.test/api/monitoring", { method: "POST", body: "x" });

afterEach(() => {
  vi.unstubAllEnvs();
  forward.mockClear();
});

describe("POST /api/monitoring", () => {
  it("answers 404 without a Sentry DSN, and forwards nothing", async () => {
    const { POST } = await route(undefined);
    expect((await POST(envelope())).status).toBe(404);
    expect(forward).not.toHaveBeenCalled();
  });

  it("hands envelopes to Sentry's tunnel when a DSN is set", async () => {
    const { POST } = await route("https://key@o1.ingest.de.sentry.io/2");
    const request = envelope();
    expect((await POST(request)).status).toBe(200);
    expect(forward).toHaveBeenCalledWith(request);
  });
});
