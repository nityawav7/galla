import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { createMemoryLimiter } from "@/lib/ratelimit";
import {
  PUBLIC_INVOICE_HEADERS,
  publicInvoiceGate,
  publicInvoiceToken,
} from "@/server/http/public-invoice-gate";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

function request(path: string, ip = "203.0.113.7"): NextRequest {
  return new NextRequest(`https://galla.test${path}`, { headers: { "x-real-ip": ip } });
}

function deps(live: boolean, requests = 60) {
  return {
    limiter: createMemoryLimiter(requests, 60),
    isLive: (token: string) => Promise.resolve(live && token === TOKEN),
    notFoundPath: "/_not-found-for-you",
  };
}

function expectPrivateHeaders(response: Response) {
  for (const [name, value] of Object.entries(PUBLIC_INVOICE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

describe("publicInvoiceToken", () => {
  it.each([
    [`/i/${TOKEN}`, TOKEN],
    [`/i/${TOKEN}/`, TOKEN],
    [`/i/${TOKEN}/pdf`, TOKEN],
    ["/i/anything", "anything"],
  ])("%s → %s", (path, token) => {
    expect(publicInvoiceToken(path)).toBe(token);
  });

  it.each(["/i", "/i/", "/b/shop/invoices", `/i/${TOKEN}/other`, `/x/i/${TOKEN}`])(
    "ignores %s",
    (path) => {
      expect(publicInvoiceToken(path)).toBeUndefined();
    },
  );
});

describe("publicInvoiceGate", () => {
  it("lets a live link through, with noindex, no-referrer and no-store", async () => {
    const response = await publicInvoiceGate(request(`/i/${TOKEN}`), TOKEN, deps(true));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expectPrivateHeaders(response);
  });

  it("rewrites a dead link to the 404 page", async () => {
    const response = await publicInvoiceGate(request(`/i/${TOKEN}`), TOKEN, deps(false));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://galla.test/_not-found-for-you",
    );
    expectPrivateHeaders(response);
  });

  it("allows 60 requests a minute per IP, then answers 429 with Retry-After (SPEC §6.2)", async () => {
    const gate = deps(true);
    for (let index = 0; index < 60; index += 1) {
      const ok = await publicInvoiceGate(request(`/i/${TOKEN}`), TOKEN, gate);
      expect(ok.status).toBe(200);
    }
    const limited = await publicInvoiceGate(request(`/i/${TOKEN}/pdf`), TOKEN, gate);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThanOrEqual(59);
    expectPrivateHeaders(limited);
    // Another IP has its own budget.
    const other = await publicInvoiceGate(request(`/i/${TOKEN}`, "198.51.100.9"), TOKEN, gate);
    expect(other.status).toBe(200);
  });

  it("counts requests even for dead links, so guessing tokens is limited too", async () => {
    const gate = deps(false, 2);
    await publicInvoiceGate(request("/i/guess-1"), "guess-1", gate);
    await publicInvoiceGate(request("/i/guess-2"), "guess-2", gate);
    const limited = await publicInvoiceGate(request("/i/guess-3"), "guess-3", gate);
    expect(limited.status).toBe(429);
  });
});
