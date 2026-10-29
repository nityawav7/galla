import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Every environment variable the app reads, validated at boot.
 * Add new variables here AND in .env.example (CLAUDE.md rule 9).
 */
export const env = createEnv({
  shared: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  server: {
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    // Set automatically by Vercel.
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  },
  client: {},
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },
  // Lint and build jobs in CI have no real secrets.
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true,
});
