import { afterEach, describe, expect, it, vi } from "vitest";

import { atTime, now } from "@/server/clock";

afterEach(() => {
  vi.useRealTimers();
});

describe("clock", () => {
  it("reads the real (or test) time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T05:00:00Z"));
    expect(now().toISOString()).toBe("2026-11-13T05:00:00.000Z");
  });

  it("runs work at a given moment, across awaits, without leaking out", async () => {
    const past = new Date("2026-05-20T04:30:00Z");
    const seen = await atTime(past, async () => {
      const first = now().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [first, now().toISOString()];
    });
    expect(seen).toEqual(["2026-05-20T04:30:00.000Z", "2026-05-20T04:30:00.000Z"]);
    expect(now().getTime()).toBeGreaterThan(past.getTime() + 1000 * 60 * 60 * 24 * 100);
  });

  it("keeps two replays apart, and a caller can't change the stored moment", async () => {
    const a = atTime(new Date("2026-01-01T00:00:00Z"), async () => {
      const moment = now();
      moment.setFullYear(1999);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return now().toISOString();
    });
    const b = atTime(new Date("2026-02-01T00:00:00Z"), () => Promise.resolve(now().toISOString()));
    expect(await Promise.all([a, b])).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ]);
  });
});
