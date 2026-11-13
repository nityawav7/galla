import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubEvent, scrubSpan, scrubText } from "@/lib/observability/scrub";

const TOKEN = "ZnBZkpsIjxSFiwpEGHqpDQ";

describe("scrubText", () => {
  it.each([
    [`https://galla.app/i/${TOKEN}`, "https://galla.app/i/:token"],
    [`/i/${TOKEN}/pdf?format=a4`, "/i/:token/pdf"],
    ["/b/sharma-hardware/customers?q=Ravi%20Kumar", "/b/:slug/customers"],
    ["GET /b/sharma-hardware/invoices/123", "GET /b/:slug/invoices/123"],
    ["/b/[businessSlug]/dashboard", "/b/:slug/dashboard"],
    ["/invite/01a1d030-595f-7127", "/invite/:id"],
    ["https://galla.app/login#code", "https://galla.app/login"],
    [
      "Failed to fetch /b/asha-stores/payments?customer=1 (500)",
      "Failed to fetch /b/:slug/payments (500)",
    ],
    ["Is the total right? Yes.", "Is the total right? Yes."],
  ])("%s → %s", (input, output) => {
    expect(scrubText(input)).toBe(output);
  });

  it("never leaves a token, slug or query string behind", () => {
    // Each value starts with a letter the fixed text doesn't contain (Q, z, q), so finding it
    // in the result can only mean it leaked, never that it matched "x.app" or ":token".
    fc.assert(
      fc.property(
        fc.stringMatching(/^Q[A-Za-z0-9_-]{7,29}$/),
        fc.stringMatching(/^z[a-z0-9-]{3,30}$/),
        fc.stringMatching(/^q[a-z]{2,11}$/),
        (token, slug, search) => {
          const text = scrubText(`https://x.app/i/${token} and /b/${slug}/c?q=${search}`);
          expect(text).not.toContain(token);
          expect(text).not.toContain(slug);
          expect(text).not.toContain(search);
        },
      ),
    );
  });
});

describe("scrubEvent", () => {
  it("keeps only the scrubbed URL of the request and drops the user", () => {
    const event = scrubEvent({
      request: {
        url: `https://galla.app/i/${TOKEN}?x=1`,
        query_string: "x=1",
        cookies: { session: "secret" },
        headers: { cookie: "session=secret", "user-agent": "x" },
        data: { phone: "+919876543210" },
        env: { REMOTE_ADDR: "1.2.3.4" },
      },
      user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" },
      message: "Not found: /b/asha-stores/customers?q=Asha",
      transaction: "/b/asha-stores/dashboard",
      exception: { values: [{ value: `No invoice for /i/${TOKEN}` }, { type: "Error" } as never] },
      breadcrumbs: [
        { message: "navigate", data: { from: "/b/asha-stores/a?q=x", to: "/login", status: 200 } },
        { data: { url: `https://galla.app/i/${TOKEN}` } },
        {},
      ],
      tags: { url: "/b/asha-stores/x", region: "bom1", count: 3 },
      extra: { path: "/b/asha-stores/y" },
    });
    expect(event.request).toEqual({ url: "https://galla.app/i/:token" });
    expect(event.user).toBeUndefined();
    expect(event.message).toBe("Not found: /b/:slug/customers");
    expect(event.transaction).toBe("/b/:slug/dashboard");
    expect(event.exception.values).toEqual([
      { value: "No invoice for /i/:token" },
      { type: "Error" },
    ]);
    expect(event.breadcrumbs).toEqual([
      { message: "navigate", data: { from: "/b/:slug/a", to: "/login", status: 200 } },
      { data: { url: "https://galla.app/i/:token" } },
      {},
    ]);
    expect(event.tags).toEqual({ url: "/b/:slug/x", region: "bom1", count: 3 });
    expect(event.extra).toEqual({ path: "/b/:slug/y" });
    expect(JSON.stringify(event)).not.toMatch(/secret|asha|1\.2\.3\.4|9876543210|ZnBZ/);
  });

  it("handles a request without a URL and an event with nothing to scrub", () => {
    expect(scrubEvent({ request: { cookies: "x" } })).toEqual({ request: {} });
    expect(scrubEvent({ exception: {} })).toEqual({ exception: {} });
    expect(scrubEvent({})).toEqual({});
  });
});

describe("scrubBreadcrumb and scrubSpan", () => {
  it("scrub messages, data and span names and attributes", () => {
    expect(scrubBreadcrumb({ category: "fetch", message: "/b/asha/x?y" })).toEqual({
      category: "fetch",
      message: "/b/:slug/x",
    });
    expect(
      scrubSpan({
        name: "GET /b/asha/invoices",
        attributes: { "url.full": `https://g.app/i/${TOKEN}?a=1`, "http.status": 200 },
      }),
    ).toEqual({
      name: "GET /b/:slug/invoices",
      attributes: { "url.full": "https://g.app/i/:token", "http.status": 200 },
    });
    expect(scrubSpan({ name: "db" })).toEqual({ name: "db" });
  });
});
