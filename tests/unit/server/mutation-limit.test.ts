import { describe, expect, it } from "vitest";

import { RateLimitError } from "@/lib/errors";
import { LIMITS } from "@/lib/ratelimit";
import { limitMutation } from "@/server/action";

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
