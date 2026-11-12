import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuth = "ok" | "unauthorized" | "notConfigured";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Checks `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends (decision 15 of the
 * Phase 10 plan). Both sides are hashed to the same length and compared in constant time, so the
 * answer's timing says nothing about the secret. Without a secret configured nothing may run.
 */
export function checkCronAuth(authorization: string | null, secret: string | undefined): CronAuth {
  if (!secret) return "notConfigured";
  const expected = digest(`Bearer ${secret}`);
  const given = digest(authorization ?? "");
  return timingSafeEqual(expected, given) ? "ok" : "unauthorized";
}
