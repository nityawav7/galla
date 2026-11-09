import { createHash } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";

export interface LimitResult {
  success: boolean;
  /** Epoch milliseconds when the window resets. */
  reset: number;
}

export interface Limiter {
  limit: (key: string) => Promise<LimitResult>;
}

/** SPEC §6.2 limits. More (mutations, demo) arrive with their routes. */
export const LIMITS = {
  auth: { requests: 5, windowSeconds: 60 },
  /** The public invoice page and its PDF together (/i/{token}). */
  publicInvoice: { requests: 60, windowSeconds: 60 },
} as const;

export type LimitName = keyof typeof LIMITS;

/**
 * Fixed-window limiter in process memory, for local dev and tests. On Vercel each
 * serverless instance would have its own counts, so production must use Redis.
 */
export function createMemoryLimiter(
  requests: number,
  windowSeconds: number,
  now: () => number = Date.now,
): Limiter {
  const windows = new Map<string, { count: number; reset: number }>();
  return {
    limit: (key) => {
      const time = now();
      let window = windows.get(key);
      if (!window || window.reset <= time) {
        window = { count: 0, reset: time + windowSeconds * 1000 };
        windows.set(key, window);
      }
      window.count += 1;
      return Promise.resolve({ success: window.count <= requests, reset: window.reset });
    },
  };
}

function redisCredentials(): { url: string; token: string } | undefined {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : undefined;
}

const limiters = new Map<LimitName, Limiter>();

export function getLimiter(name: LimitName): Limiter {
  const existing = limiters.get(name);
  if (existing) return existing;

  const { requests, windowSeconds } = LIMITS[name];
  const credentials = redisCredentials();
  let limiter: Limiter;
  if (credentials) {
    limiter = new Ratelimit({
      redis: new Redis(credentials),
      limiter: Ratelimit.slidingWindow(requests, `${windowSeconds} s`),
      // Previews and production may share one Redis database.
      prefix: `galla:${env.VERCEL_ENV ?? env.NODE_ENV}:${name}`,
    });
  } else if (env.VERCEL_ENV === "production") {
    throw new Error("Rate limiting needs UPSTASH_REDIS_REST_URL and _TOKEN in production");
  } else {
    limiter = createMemoryLimiter(requests, windowSeconds);
  }
  limiters.set(name, limiter);
  return limiter;
}

/** The caller's IP as Vercel reports it. Only ever stored hashed. */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  );
}

/** A keyed hash, so rate-limit keys and audit rows never hold a raw IP (SPEC F11). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${env.BETTER_AUTH_SECRET}:ip:${ip}`).digest("base64url");
}
