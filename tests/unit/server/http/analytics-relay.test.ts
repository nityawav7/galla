import { describe, expect, it, vi } from "vitest";

import { createMemoryLimiter } from "@/lib/ratelimit";
import { RELAY_MAX_BYTES, relayAnalytics } from "@/server/http/analytics-relay";

const HOST = "https://us.i.posthog.com";

function request(
  path = "e/",
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
) {
  return new Request(`https://galla.app/api/relay/${path}?compression=gzip-js&ver=1.4`, {
    method: "POST",
    body: '{"event":"invoice_emailed"}',
    ...init,
    headers: {
      "content-type": "text/plain",
      cookie: "better-auth.session_token=secret",
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Mozilla/5.0",
      authorization: "Bearer x",
      ...init.headers,
    },
  });
}

function deps(overrides: Partial<Parameters<typeof relayAnalytics>[2]> = {}) {
  const upstream = vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}", { status: 200 })));
  return {
    upstream,
    deps: { host: HOST, limiter: createMemoryLimiter(120, 60), fetch: upstream, ...overrides },
  };
}

describe("relayAnalytics", () => {
  it("forwards the body and query to PostHog, without cookies, IP or other headers", async () => {
    const { upstream, deps: d } = deps();
    const response = await relayAnalytics(request(), ["e"], d);
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe(`${HOST}/e?compression=gzip-js&ver=1.4`);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect([...headers.keys()]).toEqual(["content-type"]);
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"event":"invoice_emailed"}');
  });

  it("passes content-encoding through and accepts PostHog's capture paths", async () => {
    for (const path of [["e"], ["i", "v0", "e"], ["batch"], ["capture"]]) {
      const { upstream, deps: d } = deps();
      const response = await relayAnalytics(
        request(path.join("/"), { headers: { "content-encoding": "gzip" } }),
        path,
        d,
      );
      expect(response.status, path.join("/")).toBe(200);
      expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("content-encoding")).toBe(
        "gzip",
      );
    }
  });

  it("refuses anything but capture: flags, config, recordings, other hosts", async () => {
    for (const path of [
      ["flags"],
      ["decide"],
      ["s"],
      ["static", "recorder.js"],
      ["array", "x", "config"],
      [".."],
      ["e", "..", "flags"],
    ]) {
      const { upstream, deps: d } = deps();
      expect((await relayAnalytics(request(), path, d)).status, path.join("/")).toBe(404);
      expect(upstream).not.toHaveBeenCalled();
    }
  });

  it("is off without a PostHog key", async () => {
    const { upstream, deps: d } = deps({ host: undefined });
    expect((await relayAnalytics(request(), ["e"], d)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses big bodies, declared or not", async () => {
    const { upstream, deps: d } = deps();
    const declared = request("e/", { headers: { "content-length": String(RELAY_MAX_BYTES + 1) } });
    expect((await relayAnalytics(declared, ["e"], d)).status).toBe(413);
    const big = request("e/", { body: "x".repeat(RELAY_MAX_BYTES + 1) });
    expect((await relayAnalytics(big, ["e"], d)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("limits each visitor, not everyone", async () => {
    const { deps: d } = deps({ limiter: createMemoryLimiter(2, 60) });
    expect((await relayAnalytics(request(), ["e"], d)).status).toBe(200);
    expect((await relayAnalytics(request(), ["e"], d)).status).toBe(200);
    expect((await relayAnalytics(request(), ["e"], d)).status).toBe(429);
    const other = request("e/", { headers: { "x-real-ip": "198.51.100.1" } });
    expect((await relayAnalytics(other, ["e"], d)).status).toBe(200);
  });

  it("answers 502 when PostHog can't be reached, and passes its status on", async () => {
    const down = deps({ fetch: vi.fn<typeof fetch>(() => Promise.reject(new Error("offline"))) });
    expect((await relayAnalytics(request(), ["e"], down.deps)).status).toBe(502);
    const busy = deps({
      fetch: vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 503 }))),
    });
    expect((await relayAnalytics(request(), ["e"], busy.deps)).status).toBe(503);
  });
});
