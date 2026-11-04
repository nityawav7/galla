import { describe, expect, it } from "vitest";

import { createMemoryLimiter } from "@/lib/ratelimit";
import { authLimitGroup, limitAuthRequest } from "@/server/auth/rate-limit";

describe("authLimitGroup", () => {
  it.each([
    ["/api/auth/sign-in/email", "sign-in"],
    ["/api/auth/sign-in/email-otp", "sign-in"],
    ["/api/auth/sign-in/social", "sign-in"],
    ["/api/auth/sign-up/email", "sign-up"],
    ["/api/auth/email-otp/send-verification-otp", "code"],
    ["/api/auth/email-otp/request-password-reset", "code"],
    ["/api/auth/request-password-reset", "password"],
    ["/api/auth/reset-password", "password"],
    ["/api/auth/forget-password/email-otp", "password"],
  ])("%s → %s", (path, group) => {
    expect(authLimitGroup(path)).toBe(group);
  });

  it.each(["/api/auth/get-session", "/api/auth/sign-out", "/api/auth/callback/google"])(
    "does not limit %s",
    (path) => {
      expect(authLimitGroup(path)).toBeUndefined();
    },
  );
});

describe("createMemoryLimiter", () => {
  it("allows the limit, blocks the next request, and resets after the window", async () => {
    let now = 1_000_000;
    const limiter = createMemoryLimiter(2, 60, () => now);
    expect((await limiter.limit("k")).success).toBe(true);
    expect((await limiter.limit("k")).success).toBe(true);
    expect(await limiter.limit("k")).toEqual({ success: false, reset: 1_000_000 + 60_000 });
    expect((await limiter.limit("other")).success).toBe(true);
    now += 60_000;
    expect((await limiter.limit("k")).success).toBe(true);
  });
});

describe("limitAuthRequest", () => {
  const request = (path: string, ip: string) =>
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
    });

  it("returns 429 with Retry-After on the 6th attempt per IP and group (SPEC §6.2)", async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await limitAuthRequest(request("/api/auth/sign-in/email", "203.0.113.7"))).toBe(
        undefined,
      );
    }
    const limited = await limitAuthRequest(request("/api/auth/sign-in/email", "203.0.113.7"));
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await limited?.json()).toMatchObject({ code: "RATE_LIMITED" });

    // Other groups and other IPs keep their own budget.
    expect(await limitAuthRequest(request("/api/auth/sign-up/email", "203.0.113.7"))).toBe(
      undefined,
    );
    expect(await limitAuthRequest(request("/api/auth/sign-in/email", "203.0.113.8"))).toBe(
      undefined,
    );
  });

  it("never limits session reads", async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      expect(await limitAuthRequest(request("/api/auth/get-session", "203.0.113.9"))).toBe(
        undefined,
      );
    }
  });
});
