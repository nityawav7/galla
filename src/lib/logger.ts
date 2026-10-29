import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from "pino";

import { env } from "@/lib/env";

/**
 * Keys that can hold PII or secrets. They are censored wherever they appear,
 * up to three levels deep (CLAUDE.md rule 9: log IDs, never PII).
 */
export const REDACTED_KEYS = [
  "phone",
  "phoneE164",
  "email",
  "gstin",
  "pan",
  "name",
  "legalName",
  "tradeName",
  "address",
  "billingAddress",
  "shippingAddress",
  "upiVpa",
  "password",
  "token",
  "publicToken",
  "secret",
  "authorization",
  "cookie",
] as const;

const REDACT_CENSOR = "[REDACTED]";

function redactPaths(keys: readonly string[]): string[] {
  return keys.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);
}

export interface CreateLoggerOptions {
  level?: LevelWithSilent;
  destination?: DestinationStream;
}

export function createLogger({ level, destination }: CreateLoggerOptions = {}): Logger {
  const options: LoggerOptions = {
    level: level ?? env.LOG_LEVEL,
    base: {
      app: "galla",
      env: env.VERCEL_ENV ?? env.NODE_ENV,
      commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: redactPaths(REDACTED_KEYS), censor: REDACT_CENSOR },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();
