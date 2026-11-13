import { describe, expect, it } from "vitest";

import { RateLimitError } from "@/lib/errors";
import { LIMITS } from "@/lib/ratelimit";
import { limitDemoMutation, limitMutation } from "@/server/action";

describe("limitMutation", () => {
  it("allows 120 changes a minute per user, then refuses that user only (SPEC §6.2)", async () => {
    expect(LIMITS.mutation).toEqual({ requests: 120, windowSeconds: 60 });
    for (let count = 0; count < 120; count += 1) await limitMutation("user-a");
    const error = await limitMutation("user-a").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThan(0);
    await expect(limitMutation("user-b")).resolves.toBeUndefined();
  });
});

describe("limitDemoMutation", () => {
  const visitor = (ip: string) => new Headers({ "x-real-ip": ip });

  it("allows 30 changes a minute per visitor IP in the shared demo (SPEC F12)", async () => {
    expect(LIMITS.demoMutation).toEqual({ requests: 30, windowSeconds: 60 });
    for (let count = 0; count < 30; count += 1) await limitDemoMutation(visitor("203.0.113.9"));
    await expect(limitDemoMutation(visitor("203.0.113.9"))).rejects.toBeInstanceOf(RateLimitError);
    await expect(limitDemoMutation(visitor("198.51.100.4"))).resolves.toBeUndefined();
  });
});
