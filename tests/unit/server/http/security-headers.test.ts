import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";
import {
  contentSecurityPolicy,
  newNonce,
  requestIdFrom,
  STATIC_SECURITY_HEADERS,
} from "@/server/http/security-headers";

const directives = (csp: string) =>
  new Map(
    csp.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values];
    }),
  );

describe("contentSecurityPolicy", () => {
  it("allows scripts only with this request's nonce, and nothing from elsewhere", () => {
    const csp = directives(contentSecurityPolicy("abc123", { dev: false }));
    expect(csp.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
    expect([...csp.values()].flat()).not.toContain("'unsafe-eval'");
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("lets next dev use eval, and adds extra origins the browser may call", () => {
    const csp = directives(
      contentSecurityPolicy("n", { dev: true, connectSrc: ["https://o1.ingest.sentry.io"] }),
    );
    expect(csp.get("script-src")).toContain("'unsafe-eval'");
    expect(csp.get("connect-src")).toEqual(["'self'", "https://o1.ingest.sentry.io"]);
    expect(csp.has("upgrade-insecure-requests")).toBe(false);
  });
});

describe("newNonce", () => {
  it("is 128 random bits in base64, new every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("requestIdFrom", () => {
  it("uses Vercel's request id, and makes one otherwise or when it looks wrong", () => {
    expect(requestIdFrom(new Headers({ "x-vercel-id": "bom1::sin1::abc-123" }))).toBe(
      "bom1::sin1::abc-123",
    );
    expect(requestIdFrom(new Headers())).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(new Headers({ "x-vercel-id": "<script>" }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("static headers", () => {
  it("set HSTS, deny framing and turn off powerful browser features", () => {
    const headers = new Map(STATIC_SECURITY_HEADERS.map(({ key, value }) => [key, value]));
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
  });
});

describe("proxy", () => {
  const visit = (path: string) => proxy(new NextRequest(`https://galla.test${path}`));

  it("sends a CSP with a fresh nonce and a request id on public pages", async () => {
    const first = await visit("/login");
    const second = await visit("/login");
    const csp = first.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(second.headers.get("content-security-policy")).not.toBe(csp);
    expect(first.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    // The page gets the same policy, which is how Next.js finds the nonce.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(first.headers.get("x-middleware-request-x-nonce")).toEqual(expect.any(String));
  });

  it("drops a trailing slash from page URLs, keeping the query", async () => {
    for (const [path, target] of [
      ["/login/", "https://galla.test/login"],
      [
        "/b/sharma-hardware/invoices/?status=paid",
        "https://galla.test/b/sharma-hardware/invoices?status=paid",
      ],
      ["//", "https://galla.test/"],
    ] as const) {
      const response = await visit(path);
      expect(response.status, path).toBe(308);
      expect(response.headers.get("location"), path).toBe(target);
    }
    expect((await visit("/")).status).toBe(200);
  });

  it("still sends signed-out visitors of app pages to sign in, with the headers", async () => {
    for (const path of ["/b/sharma-hardware/invoices", "/onboarding"]) {
      const response = await visit(path);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://galla.test/login");
      expect(response.headers.get("content-security-policy")).toContain("'nonce-");
    }
  });
});
