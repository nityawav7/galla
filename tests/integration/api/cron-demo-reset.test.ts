import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Env from "@/lib/env";
import { closeDb } from "@/server/db/client";

const config = vi.hoisted(() => ({ secret: undefined as string | undefined }));
const job = vi.hoisted(() => ({ runs: 0 }));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof Env>();
  return {
    env: new Proxy(actual.env, {
      get: (target, key): unknown =>
        key === "CRON_SECRET" ? config.secret : (Reflect.get(target, key) as unknown),
    }),
  };
});

// The job itself is tested in tests/integration/jobs/demo-reset.test.ts; here only the route.
vi.mock("@/server/jobs/demo-reset", () => ({
  runDemoReset: () => {
    job.runs += 1;
    return Promise.resolve({ date: "2026-11-12", invoices: 523 });
  },
}));

const { GET, maxDuration } = await import("@/app/api/cron/demo-reset/route");

const SECRET = "s".repeat(40);

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/demo-reset", {
      headers: authorization ? { authorization } : {},
    }),
  );

afterAll(async () => {
  await closeDb();
});

beforeEach(() => {
  job.runs = 0;
  config.secret = SECRET;
});

describe("GET /api/cron/demo-reset", () => {
  it("runs the job with Vercel Cron's bearer secret", async () => {
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ date: "2026-11-12", invoices: 523 });
    expect(job.runs).toBe(1);
  });

  it("may run for Vercel's full 300 s", () => {
    expect(maxDuration).toBe(300);
  });

  it.each([undefined, "Bearer wrong", SECRET, `bearer ${SECRET}`, `Bearer ${SECRET}x`])(
    "answers 401 to %j and runs nothing",
    async (authorization) => {
      const response = await call(authorization);
      expect(response.status).toBe(401);
      expect(job.runs).toBe(0);
    },
  );

  it("answers 503 and runs nothing while CRON_SECRET is not set", async () => {
    config.secret = undefined;
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(job.runs).toBe(0);
  });
});
