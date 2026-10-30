import { sql } from "drizzle-orm";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { type Database, getDb } from "@/server/db/client";

import packageJson from "../../../package.json";

export interface HealthReport {
  status: "ok" | "degraded";
  db: "ok" | "error";
  version: string;
  commitSha: string;
}

// Neon's free plan suspends idle compute; waking it plus a cross-region
// WebSocket handshake can take a few seconds, which is not an outage.
const DB_TIMEOUT_MS = 8_000;

type Pingable = Pick<Database, "execute">;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(
  db?: Pingable,
  timeoutMs: number = DB_TIMEOUT_MS,
): Promise<HealthReport> {
  let dbStatus: HealthReport["db"] = "ok";
  try {
    await withTimeout((db ?? getDb()).execute(sql`select 1`), timeoutMs);
  } catch (error) {
    dbStatus = "error";
    logger.error({ err: error }, "health.db_unreachable");
  }

  return {
    status: dbStatus === "ok" ? "ok" : "degraded",
    db: dbStatus,
    version: packageJson.version,
    commitSha: env.VERCEL_GIT_COMMIT_SHA ?? "local",
  };
}
